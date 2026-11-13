#!/bin/zsh
# build_engine.sh <code file numbers>: compiles the regenerated files of the unpatched main and links tsukihime_jp (README.md).
# J: the folder with gen/main (the regenerated code, the hooks appended) and obj/ (the existing build's objects of game_main, copied).
set -e
J=${J:?set J to the working folder}; R=$(cd "$(dirname "$0")/../../.." && pwd)
FL="-I$R/framework/runtime/include -I$J/gen/main -O3 -DNDEBUG -std=gnu++20 -arch arm64 -Wno-unused-label -Wno-unused-value -Wno-parentheses-equality -Wno-unused-variable -Wno-unused-but-set-variable -Wno-constant-logical-operand -Wno-unused-function -O2 -fvisibility=hidden"
for n in "$@"; do /usr/bin/c++ ${=FL} -o $J/obj/code_$n.cpp.o -c $J/gen/main/code_$n.cpp; done
rm -f $J/libgame_main.a; ar qc $J/libgame_main.a $J/obj/*.o; ranlib $J/libgame_main.a
cd $R/framework/build/tsukihime
LINK=$(ninja -t commands tsukihime | tail -1 | sed 's/^: && //; s/ && :$//')
LINK2=$(echo "$LINK" | sed "s# libgame_main.a# $J/libgame_main.a#; s# -o tsukihime # -o $J/tsukihime_jp #")
eval "$LINK2" 2>&1 | grep -v warning || true
ls -la $J/tsukihime_jp
