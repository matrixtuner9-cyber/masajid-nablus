import re,os,sys
root=sys.argv[1]
man=os.path.join(root,'android/app/src/main/AndroidManifest.xml')
s=open(man,encoding='utf-8').read()
perms='''    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32"/>
    <uses-permission android:name="android.permission.USE_EXACT_ALARM"/>
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
    <uses-permission android:name="android.permission.VIBRATE"/>
    <uses-permission android:name="android.permission.WAKE_LOCK"/>
    <uses-permission android:name="android.permission.USE_BIOMETRIC"/>
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
    <queries>
        <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="https"/></intent>
        <intent><action android:name="android.media.action.IMAGE_CAPTURE"/></intent>
    </queries>
'''
s=s.replace('<application',perms+'    <application',1)
s=re.sub(r'android:label="[^"]*"','android:label="أئمة نابلس"',s,count=1)
receivers='''        <receiver android:exported="false" android:name="com.dexterous.flutterlocalnotifications.ScheduledNotificationReceiver"/>
        <receiver android:exported="false" android:name="com.dexterous.flutterlocalnotifications.ScheduledNotificationBootReceiver">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED"/>
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED"/>
                <action android:name="android.intent.action.QUICKBOOT_POWERON"/>
                <action android:name="com.htc.intent.action.QUICKBOOT_POWERON"/>
            </intent-filter>
        </receiver>
        <receiver android:exported="false" android:name="com.dexterous.flutterlocalnotifications.ActionBroadcastReceiver"/>
'''
s=s.replace('</application>',receivers+'    </application>')
deeplink='''            <intent-filter>
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="masajidnablus" android:host="activate"/>
            </intent-filter>
'''
s=s.replace('</activity>',deeplink+'        </activity>',1)
open(man,'w',encoding='utf-8').write(s)
# MainActivity -> FlutterFragmentActivity (needed for fingerprint)
for dp,_,fs in os.walk(os.path.join(root,'android/app/src/main')):
    for f in fs:
        if f.startswith('MainActivity'):
            p=os.path.join(dp,f);t=open(p).read()
            t=t.replace('io.flutter.embedding.android.FlutterActivity','io.flutter.embedding.android.FlutterFragmentActivity').replace(': FlutterActivity()',': FlutterFragmentActivity()').replace('extends FlutterActivity','extends FlutterFragmentActivity')
            open(p,'w').write(t)
# gradle: desugaring, minSdk, signing
g=os.path.join(root,'android/app/build.gradle.kts')
t=open(g).read()
t=t.replace('compileOptions {','compileOptions {\n        isCoreLibraryDesugaringEnabled = true',1)
t=re.sub(r'minSdk = [^\n]+','minSdk = 23',t)
t=t.replace('android {','''import java.util.Properties
val keyProps = Properties().apply { val f = rootProject.file("key.properties"); if (f.exists()) load(f.inputStream()) }
android {''',1) if 'keyProps' not in t else t
t=t.replace('buildTypes {','''signingConfigs {
        create("release") {
            keyAlias = keyProps["keyAlias"] as String?
            keyPassword = keyProps["keyPassword"] as String?
            storeFile = keyProps["storeFile"]?.let { file(it as String) }
            storePassword = keyProps["storePassword"] as String?
        }
    }
    buildTypes {''',1)
t=t.replace('signingConfig = signingConfigs.getByName("debug")','signingConfig = signingConfigs.getByName("release")')
if 'desugar_jdk_libs' not in t:
    t+='\ndependencies {\n    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")\n}\n'
# kotlin script: imports must be at top
lines=t.split('\n');imp=[l for l in lines if l.startswith('import ')];rest=[l for l in lines if not l.startswith('import ')]
open(g,'w').write('\n'.join(imp+rest))
os.makedirs(os.path.join(root,'android/app/src/main/res/drawable'),exist_ok=True)
print('android setup ok')
