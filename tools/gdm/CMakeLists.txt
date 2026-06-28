# tools/gdm/CMakeLists.txt
#
# Build du binaire `gdm` (CLI C++ lié à libgme). Définition UNIQUE partagée par :
#   - le stage Dockerfile `gdmbuilder` (compilation canonique du binaire embarqué) ;
#   - le target Nx `compile` (confort, sur un hôte/CI muni du toolchain).
#
# libgme est résolu via pkg-config (module `libgme`). Dans le stage Docker on lie
# une libgme PATCHÉE buildée FROM-SOURCE en STATIQUE (libgme.a installée sous
# /usr/local, cf. tools/gdm/patches/libgme-reglog.patch) ; le gme.h patché définit
# GME_HAS_VDM_REGLOG, ce qui ACTIVE la sous-commande `loop` (log d'écritures APU).
# Contre une libgme STOCK (brew/apt, sans le define) gdm compile aussi : la garde
# #ifdef GME_HAS_VDM_REGLOG exclut `loop` mais laisse probe/render intacts (double
# rôle préservé POUR probe/render). L'image de DÉV (node:20-bookworm-slim) n'a NI
# cmake NI libgme-dev : `cmake`/`compile` ne tournent donc PAS dans le conteneur de
# dev. Pour TESTER `loop` sur l'hôte, builder d'abord la libgme patchée (même
# recette, prefix local) avant `nx run gdm:compile`.
#
# Le binaire MVP isole les voix par mute (un rendu par canal) et n'utilise que
# l'API C de libgme. Le multi-canal « une passe » (Stratégie C) est hors périmètre :
# il exigerait l'API C++ et le chemin load_file (cf. docs/etude-gbs-libgme.md §6.1).

cmake_minimum_required(VERSION 3.16)
project(gdm CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(PkgConfig REQUIRED)
pkg_check_modules(GME REQUIRED libgme)

add_executable(gdm gdm.cpp)
target_include_directories(gdm PRIVATE ${GME_INCLUDE_DIRS})
target_link_directories(gdm PRIVATE ${GME_LIBRARY_DIRS})
# `m` (libm) est requis au lien STATIQUE (libgme.a référence sqrt/log/… non
# résolus par pkg-config en .a) ; no-op quand libgme vient d'un .so.
target_link_libraries(gdm PRIVATE ${GME_LIBRARIES} m)
target_compile_options(gdm PRIVATE -O2 -Wall ${GME_CFLAGS_OTHER})
