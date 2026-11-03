import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'auth.dart';
import 'config.dart';
import 'data.dart';
import 'home.dart';
import 'notify.dart' as nt;
import 'ui.dart';

final jump = ValueNotifier<String?>(null);

Future<void> main() async {
  runZonedGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();
    ErrorWidget.builder = (d) => Material(child: Center(child: Padding(padding: const EdgeInsets.all(16), child: SelectableText('خطأ: ${d.exception}', textDirection: TextDirection.ltr))));
    runApp(const Boot());
  }, (e, st) => debugPrint('uncaught $e'));
}

class Boot extends StatefulWidget {
  const Boot({super.key});
  @override
  State<Boot> createState() => _BootState();
}
class _BootState extends State<Boot> {
  bool ready = false;
  String? err;
  @override
  void initState() {
    super.initState();
    _init();
  }
  Future<void> _init() async {
    try {
      await initializeDateFormatting('ar');
      await Supabase.initialize(url: sbUrl, anonKey: sbKey);
    } catch (e, st) {
      err = '$e\n$st';
    }
    try {
      await nt.initNotifications(onTap: (p) => jump.value = p);
      final launch = await nt.notif.getNotificationAppLaunchDetails();
      if (launch?.didNotificationLaunchApp == true) jump.value = launch?.notificationResponse?.payload;
    } catch (_) {}
    try {
      SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(statusBarColor: cOliveDark, statusBarIconBrightness: Brightness.light));
    } catch (_) {}
    if (mounted) setState(() => ready = true);
    if (err == null) nt.startBackground();
  }
  @override
  Widget build(BuildContext context) {
    if (err != null) {
      return MaterialApp(debugShowCheckedModeBanner: false, home: Scaffold(body: SafeArea(child: Padding(padding: const EdgeInsets.all(16), child: SingleChildScrollView(child: SelectableText('تعذّر تشغيل التطبيق\n$err', textDirection: TextDirection.ltr))))));
    }
    if (!ready) return const MaterialApp(debugShowCheckedModeBanner: false, home: Scaffold(body: Center(child: CircularProgressIndicator())));
    return const ImamApp();
  }
}

class ImamApp extends StatelessWidget {
  const ImamApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'تطبيق الأئمة · مساجد نابلس',
        debugShowCheckedModeBanner: false,
        theme: appTheme(),
        locale: const Locale('ar'),
        supportedLocales: const [Locale('ar')],
        localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: const AuthGate(),
      );
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});
  @override
  State<AuthGate> createState() => _GateState();
}
class _GateState extends State<AuthGate> with WidgetsBindingObserver {
  StreamSubscription? _auth, _links;
  String? linkUser, linkCode;
  bool locked = true, checkedLock = false;
  DateTime? pausedAt;
  AppState? st;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _auth = sb.auth.onAuthStateChange.listen((e) {
      if (e.event == AuthChangeEvent.signedOut) {
        st?.stop();
        st = null;
        locked = false;
      }
      if (e.event == AuthChangeEvent.signedIn) locked = false;
      if (mounted) setState(() {});
    });
    final al = AppLinks();
    al.getInitialLink().then(_onLink).catchError((_) {});
    _links = al.uriLinkStream.listen(_onLink, onError: (_) {});
    _initLock();
  }
  Future<void> _initLock() async {
    locked = sb.auth.currentSession != null && await Bio.enabled();
    checkedLock = true;
    if (mounted) setState(() {});
    nt.requestPermissions();
  }
  void _onLink(Uri? u) {
    if (u == null) return;
    final user = u.queryParameters['u'], code = u.queryParameters['c'];
    if (user == null) return;
    if (sb.auth.currentSession != null && sb.auth.currentUser?.userMetadata?['username'] != user.toLowerCase()) {
      showDialog(
          context: context,
          builder: (c) => AlertDialog(
                title: const Text('رابط تفعيل لحساب آخر'),
                content: Text('هذا الرابط لحساب «$user». هل تريد الخروج من الحساب الحالي والدخول به؟'),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(c), child: const Text('تراجع')),
                  FilledButton(
                      onPressed: () async {
                        Navigator.pop(c);
                        await sb.auth.signOut();
                        setState(() {
                          linkUser = user;
                          linkCode = code;
                        });
                      },
                      child: const Text('نعم')),
                ],
              ));
      return;
    }
    setState(() {
      linkUser = user;
      linkCode = code;
    });
  }
  @override
  void didChangeAppLifecycleState(AppLifecycleState s) async {
    if (s == AppLifecycleState.paused) pausedAt = DateTime.now();
    if (s == AppLifecycleState.resumed && pausedAt != null && DateTime.now().difference(pausedAt!) > const Duration(minutes: 3) && sb.auth.currentSession != null && await Bio.enabled()) {
      setState(() => locked = true);
    }
  }
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _auth?.cancel();
    _links?.cancel();
    super.dispose();
  }
  @override
  Widget build(BuildContext context) {
    final s = sb.auth.currentSession;
    if (s == null) return LoginScreen(user: linkUser, code: linkCode);
    if (s.user.userMetadata?['must_change'] == true) return const SetPasswordScreen();
    if (!checkedLock) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (locked) return LockScreen(onUnlock: () => setState(() => locked = false));
    st ??= AppState();
    return HomeShell(st: st!, jump: jump);
  }
}
