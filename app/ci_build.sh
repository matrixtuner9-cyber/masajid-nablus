#!/bin/bash
# Builds the imam APK (trial build, debug-signed when no release key is configured).
set -e
SRC=$(cd "$(dirname "$0")" && pwd); ROOT=$(dirname "$SRC"); P=$RUNNER_TEMP/imam
rm -rf $P; flutter create --org ps.awqaf.nablus --project-name imam --platforms android $P >/dev/null
python3 $SRC/android_extra/setup.py $P
rm -rf $P/lib; cp -r $SRC/lib $SRC/pubspec.yaml $P/
mkdir -p $P/assets/fonts $P/android/app/src/main/res/drawable
cp $SRC/android_extra/ic_stat.xml $P/android/app/src/main/res/drawable/ic_stat.xml
python3 $SRC/mkassets.py $P/assets $ROOT/web
css=$(curl -s -A 'Mozilla/4.0' 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800')
for w in 400:Regular 600:SemiBold 700:Bold 800:ExtraBold; do n=${w%%:*}; nm=${w##*:}
  url=$(echo "$css" | python3 -c "import sys,re;c=sys.stdin.read();b=[x for x in c.split('@font-face') if 'font-weight: $n' in x];print(re.search(r'url\((.*?)\)',b[0]).group(1))")
  curl -sL -o $P/assets/fonts/Cairo-$nm.ttf "$url"; done
cd $P
flutter pub get
dart run flutter_launcher_icons
flutter analyze lib --no-fatal-infos --no-fatal-warnings || true
flutter build apk --release --target-platform android-arm,android-arm64 --build-number ${GITHUB_RUN_NUMBER:-1}
cp build/app/outputs/flutter-apk/app-release.apk $ROOT/masajid-nablus.apk
