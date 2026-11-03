import 'package:flutter/material.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'core.dart';
import 'data.dart';
import 'ui.dart';

String authErr(Object e) {
  final m = e is AuthException ? e.message : '$e';
  if (RegExp('invalid login|invalid_credentials', caseSensitive: false).hasMatch(m)) return 'اسم المستخدم أو كلمة المرور (أو رمز التفعيل) غير صحيح.';
  if (RegExp('banned', caseSensitive: false).hasMatch(m)) return 'هذا الحساب موقوف. راجع مديرية أوقاف نابلس.';
  if (RegExp('rate|too many', caseSensitive: false).hasMatch(m)) return 'محاولات كثيرة. انتظر دقائق ثم حاول مجدداً.';
  if (RegExp('same|different from the old', caseSensitive: false).hasMatch(m)) return 'اختر كلمة مرور مختلفة عن رمز التفعيل.';
  if (RegExp('weak|short', caseSensitive: false).hasMatch(m)) return 'كلمة المرور ضعيفة. استخدم 8 خانات على الأقل فيها حروف وأرقام.';
  if (RegExp('socket|network|host|connection|timed out', caseSensitive: false).hasMatch(m)) return 'تعذّر الاتصال بالخادم. تحقق من الإنترنت.';
  return 'تعذّر الدخول: $m';
}

class Bio {
  static final _la = LocalAuthentication();
  static Future<bool> available() async {
    try {
      return await _la.isDeviceSupported() && await _la.canCheckBiometrics && (await _la.getAvailableBiometrics()).isNotEmpty;
    } catch (_) {
      return false;
    }
  }
  static Future<bool> enabled() async => (await SharedPreferences.getInstance()).getBool('bio_${sb.auth.currentUser?.id}') ?? false;
  static Future<void> setEnabled(bool v) async => (await SharedPreferences.getInstance()).setBool('bio_${sb.auth.currentUser?.id}', v);
  static Future<bool> verify(String reason) async {
    try {
      return await _la.authenticate(localizedReason: reason, biometricOnly: true);
    } catch (_) {
      return false;
    }
  }
}

class TopHero extends StatelessWidget {
  final String title, subtitle;
  const TopHero({super.key, required this.title, required this.subtitle});
  @override
  Widget build(BuildContext context) => Container(
        height: 260,
        decoration: const BoxDecoration(image: DecorationImage(image: AssetImage('assets/nablus.webp'), fit: BoxFit.cover)),
        child: Container(
          decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x401F2A1A), Color(0xE61F2A1A)])),
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 40),
          alignment: AlignmentDirectional.bottomStart,
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.asset('assets/icon.png', width: 44, height: 44)),
              const SizedBox(width: 12),
              Expanded(child: Text(title, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800))),
            ]),
            const SizedBox(height: 6),
            Text(subtitle, style: const TextStyle(color: Color(0xE6FFFFFF), fontSize: 14)),
          ]),
        ),
      );
}

class LoginScreen extends StatefulWidget {
  final String? user, code;
  const LoginScreen({super.key, this.user, this.code});
  @override
  State<LoginScreen> createState() => _LoginState();
}
class _LoginState extends State<LoginScreen> {
  late final u = TextEditingController(text: widget.user ?? ''), p = TextEditingController(text: widget.code ?? '');
  bool busy = false, show = false;
  String? err;
  @override
  void didUpdateWidget(LoginScreen old) {
    super.didUpdateWidget(old);
    if (widget.user != null && widget.user != old.user) u.text = widget.user!;
    if (widget.code != null && widget.code != old.code) p.text = widget.code!;
  }
  Future<void> go() async {
    final user = u.text.trim().toLowerCase().replaceAll(RegExp(r'\s'), ''), pw = toLatin(p.text.trim());
    if (user.isEmpty || pw.isEmpty) return setState(() => err = 'أدخل اسم المستخدم ورمز التفعيل أو كلمة المرور.');
    setState(() {
      busy = true;
      err = null;
    });
    try {
      await sb.auth.signInWithPassword(email: emailOf(user), password: pw);
    } catch (e) {
      if (mounted) setState(() => err = authErr(e));
    }
    if (mounted) setState(() => busy = false);
  }
  @override
  Widget build(BuildContext context) => Scaffold(
        body: ListView(padding: EdgeInsets.zero, children: [
          const TopHero(title: 'تطبيق الأئمة', subtitle: 'مديرية أوقاف نابلس · نظام متابعة المساجد'),
          Transform.translate(
            offset: const Offset(0, -24),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Section(title: 'تسجيل الدخول', children: [
                TextField(controller: u, textDirection: TextDirection.ltr, autocorrect: false, keyboardType: TextInputType.visiblePassword, decoration: const InputDecoration(labelText: 'اسم المستخدم', prefixIcon: Icon(Icons.person_outline)), autofillHints: const [AutofillHints.username]),
                gap(),
                TextField(
                    controller: p,
                    obscureText: !show,
                    textDirection: TextDirection.ltr,
                    onSubmitted: (_) => go(),
                    decoration: InputDecoration(labelText: 'رمز التفعيل أو كلمة المرور', prefixIcon: const Icon(Icons.lock_outline), suffixIcon: IconButton(icon: Icon(show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => show = !show))),
                    autofillHints: const [AutofillHints.password]),
                if (err != null) ...[gap(10), Text(err!, style: const TextStyle(color: cBad, fontWeight: FontWeight.w600))],
                gap(16),
                FilledButton.icon(onPressed: busy ? null : go, icon: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.login), label: const Text('دخول')),
                gap(12),
                note('تصلك بيانات الدخول (اسم المستخدم ورمز التفعيل من 8 أرقام) من مديرية أوقاف نابلس عبر واتساب. عند أول دخول ستُنشئ كلمة مرور خاصة بك، ويمكنك بعدها الدخول بالبصمة.'),
                gap(8),
                note('نسيت كلمة المرور؟ اطلب من المديرية رمز تفعيل جديداً.', color: cOlive),
              ]),
            ),
          ),
        ]),
      );
}

class SetPasswordScreen extends StatefulWidget {
  final bool optional;
  const SetPasswordScreen({super.key, this.optional = false});
  @override
  State<SetPasswordScreen> createState() => _SetPwState();
}
class _SetPwState extends State<SetPasswordScreen> {
  final a = TextEditingController(), b = TextEditingController();
  bool busy = false, show = false;
  String? err;
  Future<void> save() async {
    if (!pwOk(a.text)) return setState(() => err = 'كلمة المرور 8 خانات على الأقل وتحتوي على حروف وأرقام.');
    if (a.text != b.text) return setState(() => err = 'كلمتا المرور غير متطابقتين.');
    setState(() {
      busy = true;
      err = null;
    });
    try {
      await sb.auth.updateUser(UserAttributes(password: a.text, data: {'must_change': false}));
      await sb.auth.refreshSession();
      if (!mounted) return;
      if (await Bio.available() && !(await Bio.enabled()) && mounted) {
        final yes = await showDialog<bool>(
            context: context,
            builder: (c) => AlertDialog(
                  icon: const Icon(Icons.fingerprint, size: 48, color: cOlive),
                  title: const Text('الدخول بالبصمة'),
                  content: const Text('هل تريد فتح التطبيق ببصمتك بدلاً من كتابة كلمة المرور كل مرة؟'),
                  actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('لاحقاً')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('تفعيل البصمة'))],
                ));
        if (yes == true && await Bio.verify('أكّد بصمتك لتفعيل الدخول بالبصمة')) await Bio.setEnabled(true);
      }
      if (mounted && widget.optional) {
        toast(context, 'تم تغيير كلمة المرور.');
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) setState(() => err = authErr(e));
    }
    if (mounted) setState(() => busy = false);
  }
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: widget.optional ? AppBar(title: const Text('تغيير كلمة المرور')) : null,
        body: ListView(padding: EdgeInsets.zero, children: [
          if (!widget.optional) const TopHero(title: 'أهلاً بك', subtitle: 'أنشئ كلمة مرور خاصة بك لإكمال التفعيل'),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Section(title: widget.optional ? 'كلمة المرور الجديدة' : 'إنشاء كلمة المرور', children: [
              TextField(controller: a, obscureText: !show, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: 'كلمة المرور الجديدة', suffixIcon: IconButton(icon: Icon(show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => show = !show)))),
              gap(),
              TextField(controller: b, obscureText: !show, textDirection: TextDirection.ltr, decoration: const InputDecoration(labelText: 'تأكيد كلمة المرور')),
              gap(8),
              note('8 خانات على الأقل، فيها حروف وأرقام. لا تشاركها مع أحد. رمز التفعيل يتوقف عن العمل بعد حفظها.'),
              if (err != null) ...[gap(10), Text(err!, style: const TextStyle(color: cBad, fontWeight: FontWeight.w600))],
              gap(16),
              FilledButton(onPressed: busy ? null : save, child: Text(busy ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور')),
              if (!widget.optional) ...[gap(8), TextButton(onPressed: () => sb.auth.signOut(), child: const Text('تسجيل الخروج'))],
            ]),
          ),
        ]),
      );
}

class LockScreen extends StatefulWidget {
  final VoidCallback onUnlock;
  const LockScreen({super.key, required this.onUnlock});
  @override
  State<LockScreen> createState() => _LockState();
}
class _LockState extends State<LockScreen> {
  bool usePw = false, busy = false;
  String? err;
  final p = TextEditingController();
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => bio());
  }
  Future<void> bio() async {
    if (await Bio.verify('افتح تطبيق الأئمة ببصمتك')) widget.onUnlock();
  }
  Future<void> pw() async {
    setState(() {
      busy = true;
      err = null;
    });
    try {
      final email = sb.auth.currentUser?.email ?? '';
      await sb.auth.signInWithPassword(email: email, password: p.text);
      widget.onUnlock();
    } catch (e) {
      setState(() => err = authErr(e));
    }
    if (mounted) setState(() => busy = false);
  }
  @override
  Widget build(BuildContext context) {
    final name = '${sb.auth.currentUser?.userMetadata?['name'] ?? ''}';
    return Scaffold(
      body: ListView(padding: EdgeInsets.zero, children: [
        TopHero(title: name.isEmpty ? 'تطبيق الأئمة' : 'أهلاً، ${name.split(' ').first}', subtitle: 'افتح التطبيق ببصمتك'),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Section(children: [
            if (!usePw) ...[
              Center(child: IconButton(iconSize: 84, color: cOlive, icon: const Icon(Icons.fingerprint), onPressed: bio)),
              note('المس مستشعر البصمة للمتابعة.', size: 14),
              gap(),
              OutlinedButton(onPressed: () => setState(() => usePw = true), child: const Text('الدخول بكلمة المرور')),
            ] else ...[
              TextField(controller: p, obscureText: true, textDirection: TextDirection.ltr, decoration: const InputDecoration(labelText: 'كلمة المرور'), onSubmitted: (_) => pw()),
              if (err != null) ...[gap(8), Text(err!, style: const TextStyle(color: cBad))],
              gap(),
              FilledButton(onPressed: busy ? null : pw, child: const Text('دخول')),
              TextButton(onPressed: () => setState(() => usePw = false), child: const Text('استخدام البصمة')),
            ],
            gap(8),
            TextButton(onPressed: () => sb.auth.signOut(), child: const Text('تسجيل الخروج من هذا الهاتف')),
          ]),
        ),
      ]),
    );
  }
}
