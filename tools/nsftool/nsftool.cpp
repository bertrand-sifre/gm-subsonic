/* nsftool: Linux CLI on the portable xgm core (nsfplay).
 *
 * Proves three things from a real NSF/NSFe:
 *   1. --log N --logfile F   : dump APU/CPU register writes (LOG_CPU)
 *   2. --mask M / --solo C    : per-channel WAV via the MASK bitfield
 *   3. --detect               : loop point via the engine's loop detector (ld)
 *
 * Also prints per-render RMS so channel separation is measurable.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <math.h>
#include <getopt.h>
#include <algorithm>
#include <memory>
#include <vector>
#include <string>

#include "../xgm/xgm.h"

static const char* CH_NAME[] = {
  "SQR0","SQR1","TRI","NOISE","DMC","FDS",
  "MMC5:S0","MMC5:S1","MMC5:PCM","5B:0","5B:1","5B:2",
  "VRC6:S0","VRC6:S1","VRC6:SAW","VRC7:0","VRC7:1","VRC7:2","VRC7:3","VRC7:4","VRC7:5",
  "N163:0","N163:1","N163:2","N163:3","N163:4","N163:5","N163:6","N163:7",
  "VRC7:6","VRC7:7","VRC7:8",
};

static void pack32(uint8_t* d, uint32_t n){ d[0]=n; d[1]=n>>8; d[2]=n>>16; d[3]=n>>24; }
static void pack16(uint8_t* d, uint16_t n){ d[0]=n; d[1]=n>>8; }

static void write_wav_header(FILE* f, uint64_t frames, int ch, int rate){
  uint32_t dataSize = frames*2*ch; uint8_t t[4];
  fwrite("RIFF",1,4,f); pack32(t,dataSize+36); fwrite(t,1,4,f);
  fwrite("WAVE",1,4,f); fwrite("fmt ",1,4,f);
  pack32(t,16); fwrite(t,1,4,f); pack16(t,1); fwrite(t,1,2,f);
  pack16(t,ch); fwrite(t,1,2,f); pack32(t,rate); fwrite(t,1,4,f);
  pack32(t,rate*ch*2); fwrite(t,1,4,f); pack16(t,ch*2); fwrite(t,1,2,f);
  pack16(t,16); fwrite(t,1,2,f); fwrite("data",1,4,f); pack32(t,dataSize); fwrite(t,1,4,f);
}

int main(int argc, char** argv){
  int track=1, length_ms=20000, rate=48000, ch=1;
  int mask=-1, solo=-1, loglevel=0, detect=0;
  const char* logfile=nullptr; const char* outwav=nullptr; const char* path=nullptr;

  static struct option lo[] = {
    {"track",1,0,'t'},{"length_ms",1,0,'l'},{"rate",1,0,'r'},{"channels",1,0,'c'},
    {"mask",1,0,'m'},{"solo",1,0,'s'},{"log",1,0,'g'},{"logfile",1,0,'F'},
    {"detect",0,0,'d'},{"out",1,0,'o'},{0,0,0,0}
  };
  int o;
  while((o=getopt_long(argc,argv,"t:l:r:c:m:s:g:F:do:",lo,0))!=-1){
    switch(o){
      case 't': track=atoi(optarg); break;
      case 'l': length_ms=atoi(optarg); break;
      case 'r': rate=atoi(optarg); break;
      case 'c': ch=atoi(optarg); break;
      case 'm': mask=(int)strtol(optarg,0,0); break;
      case 's': solo=atoi(optarg); break;
      case 'g': loglevel=atoi(optarg); break;
      case 'F': logfile=optarg; break;
      case 'd': detect=1; break;
      case 'o': outwav=optarg; break;
      default: return 2;
    }
  }
  if(optind>=argc){ fprintf(stderr,"usage: nsftool [opts] file.nsf[e]\n"); return 2; }
  path=argv[optind];

  xgm::NSF nsf;
  xgm::NSFPlayerConfig config;
  xgm::NSFPlayer player;

  if(!nsf.LoadFile(path)){ fprintf(stderr,"load error: %s\n",nsf.LoadError()); return 1; }
  nsf.SetDefaults(length_ms, 0, nsf.default_loopnum);

  // --solo C : mute everything except channel C (29-bit channel mask)
  if(solo>=0){ mask = ((1<<29)-1) & ~(1<<solo); }

  config["MASTER_VOLUME"] = 256;
  config["APU2_OPTION5"] = 0; // no randomized noise phase at reset (determinism)
  config["APU2_OPTION7"] = 0; // no randomized tri phase at reset
  config["RATE"] = rate;
  config["NCH"] = ch;
  config["AUTO_STOP"] = 0;    // do not auto-stop on silence (we control length)
  config["AUTO_DETECT"] = 0;  // we drive ld->IsLooped ourselves to avoid gating
  if(mask>=0) config["MASK"] = mask;
  if(loglevel>0){
    config["LOG_CPU"] = loglevel;
    config["LOG_CPU_FILE"] = logfile ? logfile : "nsf_write.log";
  }

  player.SetConfig(&config);
  if(!player.Load(&nsf)){ fprintf(stderr,"player load failed\n"); return 1; }
  player.SetPlayFreq(rate);
  player.SetChannels(ch);
  player.SetSong(track-1);
  player.Reset();

  printf("file=%s track=%d chip=0x%02X mask=0x%X log=%d detect=%d rate=%d ch=%d len=%dms\n",
         path, track, nsf.soundchip, mask<0?0:mask, loglevel, detect, rate, ch, length_ms);
  if(solo>=0) printf("solo=ch%d (%s)\n", solo, solo<32?CH_NAME[solo]:"?");

  uint64_t frames = (uint64_t)length_ms * rate / 1000;
  FILE* f=nullptr;
  if(outwav){ f=fopen(outwav,"wb"); if(!f){ perror("out"); return 1; } write_wav_header(f,frames,ch,rate); }

  const int CH=4096;
  std::vector<int16_t> buf(CH*ch);
  std::vector<uint8_t> pac(CH*ch*2);

  // loop detector params (engine defaults)
  int DETECT_TIME = config["DETECT_TIME"].GetInt(); // 30000
  int DETECT_INT  = config["DETECT_INT"].GetInt();  // 5000
  uint64_t done=0; int next_check_ms = DETECT_INT;
  int loop_start=-1, loop_end=-1; bool looped=false;
  double sumsq=0; long nsamp=0; int peak=0;

  while(done<frames){
    int n = (int)std::min<uint64_t>(CH, frames-done);
    player.Render(buf.data(), n);
    for(int i=0;i<n*ch;i++){ int s=buf[i]; sumsq+=(double)s*s; nsamp++; if(abs(s)>peak)peak=abs(s); }
    if(f){
      for(int i=0;i<n*ch;i++) pack16(&pac[i*2], (uint16_t)buf[i]);
      fwrite(pac.data(), 2*ch, n, f);
    }
    done+=n;
    int elapsed_ms = (int)(done*1000/rate);
    if(detect && !looped && elapsed_ms>=next_check_ms){
      next_check_ms += DETECT_INT;
      if(player.ld->IsLooped(elapsed_ms, DETECT_TIME, DETECT_INT)){
        looped=true; loop_start=player.ld->GetLoopStart(); loop_end=player.ld->GetLoopEnd();
      }
    }
  }
  if(f) fclose(f);

  double rms = nsamp? sqrt(sumsq/nsamp) : 0;
  printf("RMS=%.1f PEAK=%d (16-bit; rms_dBFS=%.1f)\n", rms, peak, rms>0?20*log10(rms/32768.0):-999.0);
  if(detect){
    if(looped) printf("LOOP_DETECTED start=%dms end=%dms period=%dms\n", loop_start, loop_end, loop_end-loop_start);
    else printf("LOOP_NOT_DETECTED within %dms (try longer --length_ms)\n", length_ms);
  }
  return 0;
}
