/* tools/gdm/wav.h
 *
 * Écriture d'un en-tête WAV PCM 16 bits (RIFF/WAVE/fmt/data) partagée par la
 * sous-commande `render` de gdm. Même writer / même format RIFF que
 * tools/nsftool/nsftool.cpp:32-43 — MAIS gdm écrit en STÉRÉO (ch=2 ; gme_play
 * sort toujours 2 canaux) là où les stems nsftool sont en MONO (-c 1). Le
 * block-align et la taille `data` diffèrent donc, sans incidence : l'encodage
 * (apps/server/src/render/encode.ts) n'opère que par atrim/acrossfade à la
 * FRAME, agnostique du nombre de canaux.
 *
 * `write_wav_header` accepte un nombre de canaux quelconque (`ch`) afin de
 * couvrir aussi le mode multi-canal expérimental (ch = 2 * nb_voix).
 */
#ifndef GDM_WAV_H
#define GDM_WAV_H

#include <stdint.h>
#include <stdio.h>

/** Écrit un entier 32 bits little-endian. */
static inline void pack32(uint8_t* d, uint32_t n) {
  d[0] = (uint8_t)n; d[1] = (uint8_t)(n >> 8); d[2] = (uint8_t)(n >> 16); d[3] = (uint8_t)(n >> 24);
}

/** Écrit un entier 16 bits little-endian. */
static inline void pack16(uint8_t* d, uint16_t n) {
  d[0] = (uint8_t)n; d[1] = (uint8_t)(n >> 8);
}

/**
 * Écrit l'en-tête WAV PCM 16 bits (44 octets) pour `frames` trames de `ch`
 * canaux au taux `rate`. La taille de données est `frames * 2 * ch` (2 octets
 * par échantillon 16 bits). Les échantillons PCM sont écrits ensuite par
 * l'appelant.
 */
static inline void write_wav_header(FILE* f, uint64_t frames, int ch, int rate) {
  uint32_t dataSize = (uint32_t)(frames * 2 * ch);
  uint8_t t[4];
  fwrite("RIFF", 1, 4, f); pack32(t, dataSize + 36); fwrite(t, 1, 4, f);
  fwrite("WAVE", 1, 4, f); fwrite("fmt ", 1, 4, f);
  pack32(t, 16); fwrite(t, 1, 4, f); pack16(t, 1); fwrite(t, 1, 2, f);
  pack16(t, (uint16_t)ch); fwrite(t, 1, 2, f); pack32(t, rate); fwrite(t, 1, 4, f);
  pack32(t, (uint32_t)(rate * ch * 2)); fwrite(t, 1, 4, f); pack16(t, (uint16_t)(ch * 2)); fwrite(t, 1, 2, f);
  pack16(t, 16); fwrite(t, 1, 2, f); fwrite("data", 1, 4, f); pack32(t, dataSize); fwrite(t, 1, 4, f);
}

#endif /* GDM_WAV_H */
