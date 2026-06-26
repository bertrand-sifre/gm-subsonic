# library/ — dépose tes vrais fichiers de musique de jeu ici

Ce dossier est ta **bibliothèque locale**. Il est monté dans le conteneur de dev à
`/app/library` (via le bind-mount du dépôt), donc **il suffit de glisser un fichier ici
depuis l'hôte** : il apparaît instantanément côté serveur.

## Formats décodables dès maintenant (via ffmpeg + libgme/openmpt)

`.nsf` `.nsfe` (NES) · `.spc` (SNES) · `.vgm` `.vgz` (Genesis/SMS…) · `.gbs` (Game Boy) ·
`.gym` `.ay` `.hes` `.kss` · `.mod` `.xm` `.it` `.s3m` (trackers).

Ces formats sont **émulés/séquencés** : le serveur les **décode et rend en OGG** (libgme
ne sait pas streamer vers le navigateur ; on transcode côté serveur, c'est le pilier
« rendu serveur » de la tranche 3). Un même `.nsf` contient **plusieurs sous-pistes**
(overworld, sous l'eau…) : chacune devient un morceau.

> ⚠️ Pas encore l'**USF** (OOT N64) : il faut un émulateur N64 (lazyusf2), prévu plus tard.

## Légal

Les fichiers déposés ici (souvent des rips copyrightés) **ne sont pas versionnés**
(cf. `.gitignore`). Garde-les pour ton usage local.
