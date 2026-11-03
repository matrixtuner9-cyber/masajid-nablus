#!/bin/bash
set -e
export PATH=/opt/flutter/bin:$PATH ANDROID_HOME=/opt/android JAVA_HOME=$(dirname $(dirname $(readlink -f $(which java))))
SRC=/vercel/src; P=/vercel/imam
if [ ! -d $P ]; then flutter create --org ps.awqaf.nablus --project-name imam --platforms android $P >/dev/null; python3 $SRC/android_extra/setup.py $P; fi
rm -rf $P/lib $P/assets; cp -r $SRC/lib $SRC/assets $SRC/pubspec.yaml $P/
cp $SRC/android_extra/ic_stat.xml $P/android/app/src/main/res/drawable/ic_stat.xml
mkdir -p $P/assets/fonts
if [ ! -f /vercel/fonts/Cairo-Bold.ttf ]; then
  mkdir -p /vercel/fonts; css=$(curl -s -A 'Mozilla/4.0' 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800')
  for w in 400:Regular 600:SemiBold 700:Bold 800:ExtraBold; do n=${w%%:*}; nm=${w##*:}; url=$(echo "$css" | python3 -c "import sys,re;c=sys.stdin.read();b=[x for x in c.split('@font-face') if 'font-weight: $n' in x];print(re.search(r'url\((.*?)\)',b[0]).group(1))"); curl -s -o /vercel/fonts/Cairo-$nm.ttf "$url"; done
fi
cp /vercel/fonts/*.ttf $P/assets/fonts/
if [ ! -f /vercel/keys/imam.jks ]; then mkdir -p /vercel/keys; KP=$(openssl rand -hex 12); keytool -genkeypair -v -keystore /vercel/keys/imam.jks -storepass $KP -keypass $KP -alias imam -keyalg RSA -keysize 2048 -validity 12000 -dname "CN=Awqaf Nablus, O=Nablus Awqaf Directorate, C=PS" >/dev/null 2>&1; printf "storePassword=$KP\nkeyPassword=$KP\nkeyAlias=imam\nstoreFile=/vercel/keys/imam.jks\n" > /vercel/keys/key.properties; fi
cp /vercel/keys/key.properties $P/android/key.properties
cd $P
flutter pub get
dart run flutter_launcher_icons >/dev/null
flutter analyze --no-fatal-infos --no-fatal-warnings lib 2>&1 | grep -E "error •|error -" | head -60 || true
flutter build apk --release --target-platform android-arm,android-arm64
ls -la build/app/outputs/flutter-apk/
