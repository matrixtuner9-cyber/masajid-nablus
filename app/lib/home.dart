import 'dart:async';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import 'auth.dart';
import 'config.dart';
import 'core.dart';
import 'data.dart';
import 'forms.dart';
import 'notify.dart' as nt;
import 'ui.dart';

class HomeShell extends StatefulWidget {
  final AppState st;
  final ValueNotifier<String?> jump;
  const HomeShell({super.key, required this.st, required this.jump});
  @override
  State<HomeShell> createState() => _HomeState();
}
class _HomeState extends State<HomeShell> with WidgetsBindingObserver {
  int tab = 0;
  Timer? tick;
  AppState get st => widget.st;
  static const tabs = ['prayers', 'lessons', 'monthly', 'messages', 'more'];
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    st.addListener(_changed);
    widget.jump.addListener(_jump);
    st.start();
    tick = Timer.periodic(const Duration(seconds: 30), (_) => setState(() {}));
    _jump();
  }
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    st.removeListener(_changed);
    widget.jump.removeListener(_jump);
    st.stop();
    tick?.cancel();
    super.dispose();
  }
  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) st.refresh();
  }
  void _jump() {
    final t = widget.jump.value;
    if (t == null) return;
    final i = tabs.indexOf(t);
    if (i >= 0) setState(() => tab = i);
    if (t == 'leaves' && st.me != null) WidgetsBinding.instance.addPostFrameCallback((_) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LeavesScreen(st: st))));
    widget.jump.value = null;
  }
  String _schedKey = '';
  void _changed() {
    if (!mounted) return;
    setState(() {});
    if (!st.loaded || st.uid == null) return;
    nt.notifyChanges(uid: st.uid!, thread: st.myThread, outDoc: st.myOutDoc, app: st.myApp, leaves: st.myLeaves, linked: st.me != null);
    final key = [st.me?['id'], st.me?['duties'], st.offsets, st.myLeaves?['items']?.length, st.myOutDoc?['leaves']?.length, st.today, st.myDay(st.today).keys.join()].join('|');
    if (key != _schedKey) {
      _schedKey = key;
      nt.schedulePrayers(me: st.me, offsets: st.offsets, leaves: st.myLeaves, outDoc: st.myOutDoc, months: st.myMonths);
    }
  }
  @override
  Widget build(BuildContext context) {
    final me = st.me, mq = st.mosque(me?['mosqueId']);
    final now = DateTime.now();
    final appBar = AppBar(
      toolbarHeight: 68,
      titleSpacing: 16,
      title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(mq?['name'] ?? 'تطبيق الأئمة', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18), overflow: TextOverflow.ellipsis),
        Text('${fmtD(now)} · ${hijriStr(now)}', style: const TextStyle(fontSize: 12, color: Color(0xCCFFFFFF)), overflow: TextOverflow.ellipsis),
      ]),
      actions: [
        if (st.error != null) const Padding(padding: EdgeInsets.symmetric(horizontal: 6), child: Icon(Icons.cloud_off, color: Color(0xFFF6DC9A))),
        if (me != null)
          IconButton(
            tooltip: 'الرسائل',
            onPressed: () => setState(() => tab = 3),
            icon: Badge(isLabelVisible: st.imamUnread, child: const Icon(Icons.notifications_outlined)),
          ),
      ],
      bottom: PreferredSize(preferredSize: const Size.fromHeight(3), child: Container(height: 3, color: cGold)),
    );
    if (!st.loaded) {
      return Scaffold(appBar: appBar, body: Center(child: st.error != null ? Padding(padding: const EdgeInsets.all(24), child: banner(st.error!, color: cBad, action: 'إعادة المحاولة', onTap: st.refresh)) : const CircularProgressIndicator()));
    }
    if (me == null) {
      return Scaffold(appBar: appBar, body: RefreshIndicator(onRefresh: st.refresh, child: RegistrationView(st: st)));
    }
    final pages = [PrayersTab(st: st, goto: (i) => setState(() => tab = i)), LessonsTab(st: st), MonthlyTab(st: st), MessagesTab(st: st, visible: tab == 3), MoreTab(st: st)];
    return Scaffold(
      appBar: appBar,
      body: IndexedStack(index: tab, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (i) => setState(() => tab = i),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.mosque_outlined), selectedIcon: Icon(Icons.mosque), label: 'الصلوات'),
          const NavigationDestination(icon: Icon(Icons.menu_book_outlined), selectedIcon: Icon(Icons.menu_book), label: 'الدروس'),
          const NavigationDestination(icon: Icon(Icons.assignment_outlined), selectedIcon: Icon(Icons.assignment), label: 'التقرير الشهري'),
          NavigationDestination(icon: Badge(isLabelVisible: st.imamUnread, child: const Icon(Icons.chat_bubble_outline)), selectedIcon: const Icon(Icons.chat_bubble), label: 'الرسائل'),
          const NavigationDestination(icon: Icon(Icons.more_horiz), label: 'المزيد'),
        ],
      ),
    );
  }
}

/* ======================= PRAYERS & CHECK-IN ======================= */
class PrayersTab extends StatelessWidget {
  final AppState st;
  final void Function(int) goto;
  const PrayersTab({super.key, required this.st, required this.goto});
  @override
  Widget build(BuildContext context) {
    final now = DateTime.now(), t = st.times(now), day = st.today, att = st.myDay(day), me = st.me!;
    var nx = prayers.where((p) => t[p.k]!.isAfter(now)).firstOrNull;
    DateTime when;
    String name;
    if (nx != null) {
      when = t[nx.k]!;
      name = pName(nx.k, now);
    } else {
      final tm = DateTime(now.year, now.month, now.day + 1);
      when = st.times(tm)['fajr']!;
      name = 'الفجر';
    }
    final mins = when.difference(now).inMinutes;
    final mkDue = defMonth();
    final mr = (st.myMonthly?['reports'] as Map?)?[mkDue];
    return RefreshIndicator(
      onRefresh: st.refresh,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(gradient: const LinearGradient(colors: [cOlive, cOliveDark]), borderRadius: BorderRadius.circular(18)),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('الصلاة القادمة', style: TextStyle(color: Color(0xCCFFFFFF))),
                Text('$name · ${fmtT(when)}', style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800)),
              ]),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(color: Colors.white.withValues(alpha: .15), borderRadius: BorderRadius.circular(12)),
              child: Text(mins >= 60 ? 'بعد ${mins ~/ 60} س ${mins % 60} د' : 'بعد $mins د', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
            ),
          ]),
        ),
        if (st.imamUnread) ...[gap(), banner('لديك رسالة جديدة من الإدارة.', color: cOlive, icon: Icons.mail_outline, action: 'قراءة', onTap: () => goto(3))],
        if (mkDue != day.substring(0, 7) && mr?['status'] != 'sent') ...[gap(), banner('لم تُرسل تقرير شهر ${monthAr(mkDue)} بعد.', color: cBad, action: 'كتابة التقرير', onTap: () => goto(2))],
        gap(),
        for (final p in prayers) ...[_prayerCard(context, p, t, att, now, me), gap(10)],
        note('التسجيل يُفتح قبل الأذان بـ$openBefore دقيقة، ويُحسب تأخيراً بعد $lateAfter دقيقة من الأذان. المواقيت معتمدة من مديرية الأوقاف لمدينة نابلس.'),
      ]),
    );
  }
  Widget _prayerCard(BuildContext context, Prayer p, Map<String, DateTime> t, Map att, DateTime now, Map me) {
    final w = windowOf(p.k, t), rec = att[p.k] as Map?, s = st.statusOf(rec, p.k, st.today);
    final open = !now.isBefore(w.open) && now.isBefore(w.close), isNow = open && rec == null;
    Widget act;
    if (rec != null) {
      act = note('سُجّل الساعة ${fmtT(DateTime.tryParse('${rec['at']}'))} برمز المسجد${rec['sub'] == true ? ' · حضر البديل' : ''}${rec['v'] == false ? ' · رفضت الإدارة الرمز' : ''}${rec['pv'] == false ? ' · رفضت الإدارة صورة الإثبات' : rec['photo'] != null ? ' · مع صورة إثبات' : ''}');
    } else if (s == 'na') {
      act = note('هذه الصلاة ليست ضمن تكليفك.');
    } else if (s == 'leave') {
      act = note('أنت في إجازة معتمدة.');
    } else if (open) {
      act = Row(children: [
        Expanded(child: FilledButton.icon(onPressed: () => CheckInSheet.open(context, st, p.k), icon: const Icon(Icons.how_to_reg), label: const Text('تسجيل الحضور'))),
        const SizedBox(width: 10),
        note('يُغلق ${fmtT(w.close)}'),
      ]);
    } else if (now.isBefore(w.open)) {
      act = note('يُفتح التسجيل ${fmtT(w.open)}');
    } else {
      act = note('انتهى وقت التسجيل لهذه الصلاة.', color: cBad);
    }
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: isNow ? cGold : const Color(0x1A1F2A1A), width: isNow ? 2 : 1)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(pName(p.k, now), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              note('الأذان ${fmtT(t[p.k])}'),
            ])),
            chip(isNow && s == 'pending' ? 'open' : s, rec != null && ((rec['min'] ?? 0) as num) > 0 ? '${rec['min']} د' : null),
          ]),
          gap(10),
          act,
        ]),
      ),
    );
  }
}

class CheckInSheet extends StatefulWidget {
  final AppState st;
  final String k;
  const CheckInSheet({super.key, required this.st, required this.k});
  static Future<void> open(BuildContext ctx, AppState st, String k) async {
    showDialog(context: ctx, barrierDismissible: false, builder: (_) => const Center(child: CircularProgressIndicator()));
    await st.decidePhoto(k);
    if (!ctx.mounted) return;
    Navigator.pop(ctx);
    await showModalBottomSheet(context: ctx, isScrollControlled: true, useSafeArea: true, showDragHandle: true, builder: (_) => CheckInSheet(st: st, k: k));
  }
  @override
  State<CheckInSheet> createState() => _CheckInState();
}
class _CheckInState extends State<CheckInSheet> {
  final code = TextEditingController();
  String? photoId, photoAt, msg;
  bool busy = false, skip = false, bySub = false;
  AppState get st => widget.st;
  Future<void> shoot(Map ask) async {
    setState(() {
      busy = true;
      msg = null;
    });
    try {
      final x = await ImagePicker().pickImage(source: ImageSource.camera, preferredCameraDevice: CameraDevice.rear, maxWidth: 2000, imageQuality: 90);
      if (x == null) {
        setState(() => busy = false);
        return;
      }
      final me = st.me!, mq = st.mosque(me['mosqueId']);
      final at = DateTime.now();
      final stamped = await stampPhoto(await x.readAsBytes(), ['${me['name']} · ${mq?['name'] ?? ''}', '${pName(widget.k, at)} · ${fmtShort(at)}', 'المطلوب: ${ask['subject']}']);
      photoId = await Docs.uploadPhoto(stamped);
      photoAt = at.toUtc().toIso8601String();
    } catch (e) {
      msg = 'تعذّر رفع الصورة، حاول مرة أخرى.';
    }
    if (mounted) setState(() => busy = false);
  }
  Future<void> confirm() async {
    setState(() {
      busy = true;
      msg = null;
    });
    final r = await st.checkIn(widget.k, code.text, photoId: photoId, photoAt: photoAt, noPhoto: skip, bySub: bySub);
    if (!mounted) return;
    if (r == null) {
      nt.cancelReminder(widget.k);
      Navigator.pop(context);
      toast(context, 'سُجّل حضورك لصلاة ${pName(widget.k, DateTime.now())}. بارك الله فيك.');
    } else {
      setState(() {
        msg = r;
        busy = false;
      });
    }
  }
  @override
  Widget build(BuildContext context) {
    final ask = st.photoAsk(widget.k), me = st.me!;
    final needPhoto = ask?['need'] == true && photoId == null && !skip;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewInsets.bottom + 20),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('تسجيل حضور صلاة ${pName(widget.k, DateTime.now())}', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
        gap(),
        if (needPhoto) ...[
          banner('صورة إثبات مطلوبة: صوّر الآن «${ask!['subject']}».', icon: Icons.photo_camera_outlined),
          gap(),
          FilledButton.icon(onPressed: busy ? null : () => shoot(ask), icon: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.photo_camera), label: Text(busy ? 'جارٍ التجهيز والرفع…' : 'فتح الكاميرا والتقاط الصورة')),
          if (msg != null) ...[gap(8), Text(msg!, style: const TextStyle(color: cBad)), TextButton(onPressed: () => setState(() => skip = true), child: const Text('المتابعة دون صورة (ستُبلَّغ الإدارة)'))],
        ] else ...[
          if (photoId != null) Row(children: [SizedBox(width: 72, height: 72, child: netPhoto(photoId!)), const SizedBox(width: 10), const Expanded(child: Text('رُفعت صورة الإثبات. أدخل رمز المسجد للتأكيد.', style: TextStyle(color: cOk, fontWeight: FontWeight.w700)))]),
          if (photoId != null) gap(),
          TextField(
            controller: code,
            autofocus: true,
            keyboardType: TextInputType.number,
            maxLength: 6,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 28, letterSpacing: 10, fontWeight: FontWeight.w800),
            decoration: const InputDecoration(labelText: 'رمز المسجد (6 أرقام)', counterText: ''),
            onSubmitted: (_) => confirm(),
          ),
          if ('${me['subName'] ?? ''}'.isNotEmpty) ...[
            gap(8),
            SegmentedButton<bool>(segments: [const ButtonSegment(value: false, label: Text('حضرتُ بنفسي')), ButtonSegment(value: true, label: Text('حضر البديل: ${me['subName']}'))], selected: {bySub}, onSelectionChanged: (s) => setState(() => bySub = s.first)),
          ],
          if (msg != null) ...[gap(8), Text(msg!, style: const TextStyle(color: cBad, fontWeight: FontWeight.w600))],
          gap(),
          FilledButton(onPressed: busy ? null : confirm, child: Text(busy ? 'جارٍ الحفظ…' : 'تأكيد الحضور')),
        ],
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('إلغاء')),
      ]),
    );
  }
}

/* ======================= MESSAGES ======================= */
class MessagesTab extends StatefulWidget {
  final AppState st;
  final bool visible;
  const MessagesTab({super.key, required this.st, required this.visible});
  @override
  State<MessagesTab> createState() => _MsgState();
}
class _MsgState extends State<MessagesTab> {
  final ctl = TextEditingController(), scroll = ScrollController();
  String? photo;
  bool busy = false;
  @override
  void didUpdateWidget(MessagesTab old) {
    super.didUpdateWidget(old);
    if (widget.visible) widget.st.markSeen();
  }
  Future<void> attach() async {
    final x = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2000);
    if (x == null) return;
    setState(() => busy = true);
    try {
      photo = await Docs.uploadPhoto(await shrinkJpeg(await x.readAsBytes()));
    } catch (_) {
      if (mounted) toast(context, 'تعذّر رفع الصورة.', bad: true);
    }
    if (mounted) setState(() => busy = false);
  }
  Future<void> send() async {
    final t = ctl.text.trim();
    if (t.isEmpty && photo == null) return;
    setState(() => busy = true);
    try {
      await widget.st.sendMsg(t, photo);
      ctl.clear();
      photo = null;
    } catch (_) {
      if (mounted) toast(context, 'تعذّر الإرسال، حاول مرة أخرى.', bad: true);
    }
    if (mounted) setState(() => busy = false);
  }
  @override
  Widget build(BuildContext context) {
    final msgs = widget.st.messages;
    return Column(children: [
      Expanded(
        child: msgs.isEmpty
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: note('لا توجد رسائل بعد. اكتب رسالتك الأولى إلى مديرية أوقاف نابلس.', size: 15)))
            : ListView.builder(
                reverse: true,
                controller: scroll,
                padding: const EdgeInsets.all(12),
                itemCount: msgs.length,
                itemBuilder: (_, i) {
                  final m = msgs[msgs.length - 1 - i], mine = m['from'] == 'imam';
                  return Align(
                    alignment: mine ? AlignmentDirectional.centerStart : AlignmentDirectional.centerEnd,
                    child: Container(
                      constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * .8),
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(color: mine ? cOlive.withValues(alpha: .12) : Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0x1A1F2A1A))),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(mine ? 'أنا' : 'مديرية الأوقاف', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12, color: mine ? cOlive : cGold)),
                        if ('${m['text'] ?? ''}'.isNotEmpty) Text('${m['text']}', style: const TextStyle(fontSize: 15, height: 1.5)),
                        if (m['photo'] != null) Padding(padding: const EdgeInsets.only(top: 6), child: GestureDetector(onTap: () => openPhoto(context, '${m['photo']}'), child: netPhoto('${m['photo']}', h: 160))),
                        Text(fmtShort(DateTime.parse('${m['at']}')), style: const TextStyle(fontSize: 11, color: cMuted)),
                      ]),
                    ),
                  );
                }),
      ),
      if (photo != null) Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Row(children: [SizedBox(width: 56, height: 56, child: netPhoto(photo!)), TextButton(onPressed: () => setState(() => photo = null), child: const Text('إزالة الصورة'))])),
      Container(
        color: cCard,
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
        child: SafeArea(
          top: false,
          child: Row(children: [
            IconButton(onPressed: busy ? null : attach, icon: const Icon(Icons.image_outlined)),
            Expanded(child: TextField(controller: ctl, minLines: 1, maxLines: 4, decoration: const InputDecoration(hintText: 'اكتب رسالتك…', isDense: true))),
            const SizedBox(width: 6),
            IconButton.filled(onPressed: busy ? null : send, icon: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send)),
          ]),
        ),
      ),
    ]);
  }
}

/* ======================= MORE ======================= */
class MoreTab extends StatefulWidget {
  final AppState st;
  const MoreTab({super.key, required this.st});
  @override
  State<MoreTab> createState() => _MoreState();
}
class _MoreState extends State<MoreTab> {
  bool bioAvail = false, bio = false, adhan = true, remind = true;
  @override
  void initState() {
    super.initState();
    load();
  }
  Future<void> load() async {
    final sp = await SharedPreferences.getInstance();
    bioAvail = await Bio.available();
    bio = await Bio.enabled();
    adhan = sp.getBool('n_adhan') ?? true;
    remind = sp.getBool('n_remind') ?? true;
    if (mounted) setState(() {});
  }
  Future<void> setPref(String k, bool v) async {
    await (await SharedPreferences.getInstance()).setBool(k, v);
    await load();
    final st = widget.st;
    await nt.schedulePrayers(me: st.me, offsets: st.offsets, leaves: st.myLeaves, outDoc: st.myOutDoc, months: st.myMonths);
  }
  @override
  Widget build(BuildContext context) {
    final st = widget.st, me = st.me!, mq = st.mosque(me['mosqueId']);
    final u = sb.auth.currentUser;
    void push(Widget w) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => w));
    return ListView(padding: const EdgeInsets.all(16), children: [
      Section(children: [
        Row(children: [
          const CircleAvatar(radius: 26, backgroundColor: cOlive, child: Icon(Icons.person, color: Colors.white)),
          const SizedBox(width: 12),
          Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${me['name']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            note('${me['role'] ?? ''} · ${mq?['name'] ?? ''}'),
            note('اسم المستخدم: ${u?.userMetadata?['username'] ?? ''}', size: 12),
          ])),
        ]),
      ]),
      gap(),
      Card(
          child: Column(children: [
        ListTile(leading: const Icon(Icons.report_outlined), title: const Text('بلاغ عن حال المسجد'), subtitle: const Text('صيانة، نظافة، كهرباء، سجاد…'), trailing: const Icon(Icons.chevron_left), onTap: () => push(ReportsScreen(st: st))),
        const Divider(height: 1),
        ListTile(leading: const Icon(Icons.event_busy_outlined), title: const Text('طلب إجازة وبديل'), trailing: const Icon(Icons.chevron_left), onTap: () => push(LeavesScreen(st: st))),
        const Divider(height: 1),
        ListTile(leading: const Icon(Icons.history), title: const Text('سجل حضوري'), subtitle: const Text('آخر 30 يوماً'), trailing: const Icon(Icons.chevron_left), onTap: () => push(HistoryScreen(st: st))),
      ])),
      gap(),
      Card(
          child: Column(children: [
        SwitchListTile(secondary: const Icon(Icons.fingerprint), title: const Text('الدخول بالبصمة'), subtitle: Text(bioAvail ? 'افتح التطبيق ببصمتك' : 'لا توجد بصمة مسجّلة على هذا الهاتف'), value: bio, onChanged: !bioAvail ? null : (v) async {
          if (v && !await Bio.verify('أكّد بصمتك لتفعيل الدخول بالبصمة')) return;
          await Bio.setEnabled(v);
          load();
        }),
        const Divider(height: 1),
        SwitchListTile(secondary: const Icon(Icons.notifications_active_outlined), title: const Text('تنبيه عند الأذان'), value: adhan, onChanged: (v) => setPref('n_adhan', v)),
        const Divider(height: 1),
        SwitchListTile(secondary: const Icon(Icons.alarm), title: const Text('تذكير إن لم أسجّل الحضور'), subtitle: const Text('بعد 12 دقيقة من الأذان'), value: remind, onChanged: (v) => setPref('n_remind', v)),
        const Divider(height: 1),
        ListTile(leading: const Icon(Icons.password), title: const Text('تغيير كلمة المرور'), trailing: const Icon(Icons.chevron_left), onTap: () => push(const SetPasswordScreen(optional: true))),
      ])),
      gap(),
      Card(
          child: Column(children: [
        ListTile(leading: const Icon(Icons.system_update), title: const Text('تنزيل آخر إصدار من التطبيق'), subtitle: const Text('الإصدار $appVersion'), onTap: () => launchUrl(Uri.parse(apkUrl), mode: LaunchMode.externalApplication)),
        const Divider(height: 1),
        ListTile(leading: const Icon(Icons.logout, color: cBad), title: const Text('تسجيل الخروج', style: TextStyle(color: cBad)), onTap: () async {
          final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(title: const Text('تسجيل الخروج؟'), content: const Text('ستحتاج اسم المستخدم وكلمة المرور للدخول مجدداً.'), actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('تراجع')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('خروج'))]));
          if (ok == true) {
            await nt.notif.cancelAll();
            await sb.auth.signOut();
          }
        }),
      ])),
      gap(),
      Center(child: note('آخر تحديث: ${st.lastSync == null ? '—' : fmtT(st.lastSync)}', size: 12)),
    ]);
  }
}
