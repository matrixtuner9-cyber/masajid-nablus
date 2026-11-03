import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'core.dart';
import 'data.dart';
import 'ui.dart';

Widget _dd<T>(String label, T value, List<(T, String)> items, void Function(T) on) => DropdownButtonFormField<T>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [for (final (v, l) in items) DropdownMenuItem(value: v, child: Text(l, overflow: TextOverflow.ellipsis))],
      onChanged: (v) {
        if (v != null) on(v);
      },
    );
Widget _tf(TextEditingController c, String label, {String? hint, TextInputType? kb, int lines = 1, TextDirection? dir, int? max}) => TextField(
      controller: c,
      keyboardType: kb,
      minLines: lines,
      maxLines: lines == 1 ? 1 : lines + 3,
      maxLength: max,
      textDirection: dir,
      decoration: InputDecoration(labelText: label, hintText: hint, counterText: ''),
    );
Widget _err(List<String> e) => e.isEmpty ? const SizedBox.shrink() : Padding(padding: const EdgeInsets.only(top: 10), child: banner(e.join('\n'), color: cBad, icon: Icons.error_outline));

/* ======================= REGISTRATION (before the directorate links the account) ======================= */
class RegistrationView extends StatefulWidget {
  final AppState st;
  const RegistrationView({super.key, required this.st});
  @override
  State<RegistrationView> createState() => _RegState();
}
class _RegState extends State<RegistrationView> {
  final name = TextEditingController(), idNo = TextEditingController(), phone = TextEditingController(), other = TextEditingController(), subName = TextEditingController(), subId = TextEditingController(), subPhone = TextEditingController();
  String role = roles.first, mosqueId = '__other';
  bool hasSub = false, editing = false, busy = false, filled = false;
  List<String> errs = [];
  AppState get st => widget.st;
  void fill() {
    final a = st.myApp;
    final mu = sb.auth.currentUser?.userMetadata ?? {};
    if (a != null) {
      name.text = '${a['name'] ?? ''}';
      idNo.text = '${a['idNo'] ?? ''}';
      phone.text = '${a['phone'] ?? ''}'.replaceFirst('+970', '0');
      role = roles.contains(a['role']) ? a['role'] : roles.first;
      mosqueId = a['mosqueId'] ?? '__other';
      other.text = '${a['mosqueOther'] ?? ''}';
      hasSub = a['hasSub'] == true;
      subName.text = '${a['subName'] ?? ''}';
      subId.text = '${a['subId'] ?? ''}';
      subPhone.text = '${a['subPhone'] ?? ''}'.replaceFirst('+970', '0');
    } else {
      name.text = '${mu['name'] ?? ''}';
      phone.text = '${mu['phone'] ?? ''}'.replaceFirst('+970', '0');
      if (st.mosques.isNotEmpty) mosqueId = st.mosques.first['id'];
    }
    filled = true;
  }
  Future<void> submit() async {
    final e = <String>[];
    if (!fourPart(name.text)) e.add('اكتب الاسم الرباعي كاملاً (أربعة مقاطع على الأقل).');
    if (!validId(idNo.text)) e.add('رقم الهوية يجب أن يتكوّن من 9 أرقام.');
    final ph = normPhone(phone.text);
    if (ph == null) e.add('رقم الواتساب غير صحيح. اكتبه بصيغة 059xxxxxxx.');
    if (mosqueId == '__other' && other.text.trim().isEmpty) e.add('اكتب اسم المسجد الذي تتولاه.');
    String? sph;
    if (hasSub) {
      if (!fourPart(subName.text)) e.add('اكتب الاسم الرباعي للإمام البديل.');
      if (subId.text.isNotEmpty && !validId(subId.text)) e.add('رقم هوية الإمام البديل يجب أن يتكوّن من 9 أرقام.');
      sph = normPhone(subPhone.text);
      if (sph == null) e.add('رقم واتساب الإمام البديل غير صحيح.');
    }
    setState(() => errs = e);
    if (e.isNotEmpty) return;
    setState(() => busy = true);
    final a = st.myApp;
    final now = DateTime.now().toUtc().toIso8601String();
    try {
      await Docs.set('applications/${st.uid}', {
        'uid': st.uid,
        'name': name.text.trim().replaceAll(RegExp(r'\s+'), ' '),
        'idNo': cleanId(idNo.text),
        'phone': ph,
        'role': role,
        'mosqueId': mosqueId == '__other' ? null : mosqueId,
        'mosqueOther': mosqueId == '__other' ? other.text.trim() : '',
        'hasSub': hasSub,
        'subName': hasSub ? subName.text.trim().replaceAll(RegExp(r'\s+'), ' ') : '',
        'subId': hasSub && subId.text.isNotEmpty ? cleanId(subId.text) : '',
        'subPhone': hasSub ? sph : '',
        'status': 'pending',
        'submittedAt': (a != null && a['status'] == 'pending' ? a['submittedAt'] : null) ?? now,
        'updatedAt': now,
        'via': 'app',
      });
      editing = false;
      await st.refresh();
    } catch (_) {
      setState(() => errs = ['تعذّر إرسال الطلب. تحقق من الاتصال وحاول مرة أخرى.']);
    }
    if (mounted) setState(() => busy = false);
  }
  @override
  Widget build(BuildContext context) {
    final a = st.myApp;
    if (a != null && a['status'] == 'pending' && !editing) {
      final m = st.mosque(a['mosqueId']);
      return ListView(padding: const EdgeInsets.all(16), children: [
        Section(title: 'طلبك قيد المراجعة', trailing: tagChip('بانتظار الموافقة', cWarn), children: [
          note('ستتمكن من تسجيل الحضور فور موافقة مديرية الأوقاف على طلبك، وسيصلك تنبيه بذلك.', size: 14),
          gap(),
          _row('الاسم الرباعي', '${a['name']}'),
          _row('رقم الهوية', '${a['idNo']}'),
          _row('واتساب', '${a['phone']}'),
          _row('الصفة', '${a['role']}'),
          _row('المسجد', m != null ? '${m['name']}' : '${a['mosqueOther']} (غير مدرج)'),
          _row('الإمام البديل', a['hasSub'] == true ? '${a['subName']} · ${a['subPhone']}' : 'لا يوجد'),
          gap(),
          OutlinedButton(onPressed: () => setState(() {
                editing = true;
                fill();
              }), child: const Text('تعديل بيانات الطلب')),
        ]),
      ]);
    }
    if (!filled) fill();
    return ListView(padding: const EdgeInsets.all(16), children: [
      if (a != null && a['status'] == 'rejected') ...[banner('رُفض طلبك السابق: ${a['reason'] ?? 'راجع البيانات وأعد الإرسال.'}', color: cBad), gap()],
      if (a != null && a['status'] == 'approved') ...[banner('تمت الموافقة سابقاً لكن الإدارة أوقفت ربط حسابك أو نقلته. راجع المديرية أو قدّم طلباً جديداً.', color: cWarn), gap()],
      Section(title: a != null && a['status'] == 'pending' ? 'تعديل طلب التسجيل' : 'طلب تسجيل إمام أو مؤذن', children: [
        note('عبّئ بياناتك بدقة. تراجع مديرية أوقاف نابلس الطلب، وبعد الموافقة تستطيع تسجيل حضورك. رقم الهوية والهاتف لا يطّلع عليهما إلا إدارة النظام.'),
        gap(),
        _tf(name, 'الاسم الرباعي', hint: 'الاسم الأول – الأب – الجد – العائلة'),
        gap(),
        _tf(idNo, 'رقم الهوية', kb: TextInputType.number, dir: TextDirection.ltr, max: 9),
        gap(),
        _tf(phone, 'رقم الواتساب', hint: '059xxxxxxx', kb: TextInputType.phone, dir: TextDirection.ltr),
        gap(),
        _dd('الصفة', role, [for (final r in roles) (r, r)], (v) => setState(() => role = v)),
        gap(),
        _dd('المسجد المسؤول عنه', mosqueId, [for (final m in st.mosques) ('${m['id']}', '${m['name']}${m['area'] != null && '${m['area']}'.isNotEmpty ? ' – ${m['area']}' : ''}'), ('__other', 'مسجدي غير موجود في القائمة')], (v) => setState(() => mosqueId = v)),
        if (mosqueId == '__other') ...[gap(), _tf(other, 'اسم المسجد وموقعه', hint: 'مثال: مسجد عمر بن الخطاب – رفيديا')],
        gap(),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('للمسجد إمام بديل'), value: hasSub, onChanged: (v) => setState(() => hasSub = v)),
        if (hasSub) ...[
          _tf(subName, 'الاسم الرباعي للبديل'),
          gap(),
          _tf(subId, 'رقم هوية البديل (اختياري)', kb: TextInputType.number, dir: TextDirection.ltr, max: 9),
          gap(),
          _tf(subPhone, 'واتساب البديل', hint: '059xxxxxxx', kb: TextInputType.phone, dir: TextDirection.ltr),
        ],
        _err(errs),
        gap(16),
        FilledButton(onPressed: busy ? null : submit, child: Text(busy ? 'جارٍ الإرسال…' : a != null && a['status'] == 'pending' ? 'حفظ التعديلات' : 'إرسال الطلب للموافقة')),
        if (editing) TextButton(onPressed: () => setState(() => editing = false), child: const Text('إلغاء')),
      ]),
    ]);
  }
}
Widget _row(String k, String v) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [SizedBox(width: 120, child: Text(k, style: const TextStyle(color: cMuted))), Expanded(child: Text(v, style: const TextStyle(fontWeight: FontWeight.w600)))]));

/* ======================= LESSONS ======================= */
class LessonsTab extends StatefulWidget {
  final AppState st;
  const LessonsTab({super.key, required this.st});
  @override
  State<LessonsTab> createState() => _LessonsState();
}
class _LessonsState extends State<LessonsTab> {
  final topic = TextEditingController(), n = TextEditingController(), dur = TextEditingController(text: '20'), notes = TextEditingController();
  String type = lessonTypes.first, after = 'maghrib';
  bool busy = false;
  List<String> errs = [];
  Future<void> save() async {
    if (topic.text.trim().isEmpty) return setState(() => errs = ['اكتب موضوع الدرس.']);
    final st = widget.st, me = st.me!;
    setState(() {
      busy = true;
      errs = [];
    });
    final now = DateTime.now(), day = dkey(now), mk = day.substring(0, 7);
    try {
      await Docs.upsertMerge('att/${mk}_${me['id']}', {
        'mosqueId': me['mosqueId'],
        'l': {
          newId(): {'date': day, 'createdAt': now.toUtc().toIso8601String(), 'mosqueId': me['mosqueId'], 'topic': topic.text.trim(), 'type': type, 'after': after, 'attendees': int.tryParse(toLatin(n.text)) ?? 0, 'duration': int.tryParse(toLatin(dur.text)) ?? 0, 'notes': notes.text.trim(), 'by': st.uid}
        }
      }, {'month': mk, 'staffId': me['id'], 'uid': st.uid});
      topic.clear();
      n.clear();
      notes.clear();
      await st.refresh();
      if (mounted) toast(context, 'سُجّل الدرس.');
    } catch (_) {
      setState(() => errs = ['تعذّر الحفظ، حاول مرة أخرى.']);
    }
    if (mounted) setState(() => busy = false);
  }
  @override
  Widget build(BuildContext context) {
    final st = widget.st;
    final all = <Map<String, dynamic>>[];
    for (final d in st.myMonths.values) {
      ((d?['l'] as Map?) ?? {}).forEach((k, v) => all.add({'id': k, ...Map<String, dynamic>.from(v as Map)}));
    }
    all.sort((a, b) => '${b['createdAt']}'.compareTo('${a['createdAt']}'));
    return ListView(padding: const EdgeInsets.all(16), children: [
      Section(title: 'تسجيل درس أو نشاط', children: [
        _tf(topic, 'الموضوع', hint: 'مثال: أحكام الطهارة'),
        gap(),
        Row(children: [
          Expanded(child: _dd('النوع', type, [for (final t in lessonTypes) (t, t)], (v) => setState(() => type = v))),
          const SizedBox(width: 10),
          Expanded(child: _dd('التوقيت', after, [for (final p in prayers) (p.k, 'بعد ${p.n}')], (v) => setState(() => after = v))),
        ]),
        gap(),
        Row(children: [Expanded(child: _tf(n, 'عدد الحضور', kb: TextInputType.number)), const SizedBox(width: 10), Expanded(child: _tf(dur, 'المدة (دقيقة)', kb: TextInputType.number))]),
        gap(),
        _tf(notes, 'ملاحظات (اختياري)', lines: 2),
        _err(errs),
        gap(16),
        FilledButton(onPressed: busy ? null : save, child: Text(busy ? 'جارٍ الحفظ…' : 'حفظ الدرس')),
      ]),
      gap(),
      Section(title: 'دروسي الأخيرة', children: [
        if (all.isEmpty) note('لم تسجّل دروساً بعد.'),
        for (final l in all.take(15))
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [Expanded(child: Text('${l['topic']}', style: const TextStyle(fontWeight: FontWeight.w700))), note('${l['date']}', size: 12)]),
              note([l['type'], 'بعد ${pPlain('${l['after']}')}', '${l['attendees']} حاضر', '${l['duration']} د'].join(' · '), size: 12),
            ]),
          ),
      ]),
    ]);
  }
}

/* ======================= MONTHLY REPORT ======================= */
const mrFields = [
  ('news', 'أبرز المستجدات والأنشطة (مطلوب)', 'ما الذي جرى في المسجد هذا الشهر: أنشطة، مناسبات، دورات…'),
  ('needs', 'احتياجات المسجد', 'مثال: سجاد، مصاحف، صيانة سماعات…'),
  ('issues', 'المشكلات والملاحظات', 'أي صعوبات تواجه المسجد أو العاملين فيه'),
  ('suggestions', 'المقترحات', 'اقتراحات لتطوير العمل في المسجد'),
];
class MonthlyTab extends StatefulWidget {
  final AppState st;
  const MonthlyTab({super.key, required this.st});
  @override
  State<MonthlyTab> createState() => _MonthlyState();
}
class _MonthlyState extends State<MonthlyTab> {
  String mk = defMonth();
  String? loadedFor;
  final c = {for (final f in ['wf', 'wd', 'wj', 'qc', 'qs', 'news', 'needs', 'issues', 'suggestions']) f: TextEditingController()};
  List<String> photos = [];
  bool busy = false;
  String? phMsg;
  List<String> errs = [];
  Map<String, dynamic> get all => Map<String, dynamic>.from((widget.st.myMonthly?['reports'] as Map?) ?? {});
  void load() {
    final s = all[mk] as Map?;
    String v(dynamic x) => x == null ? '' : '$x';
    c['wf']!.text = v(s?['w']?['fajr']);
    c['wd']!.text = v(s?['w']?['daily']);
    c['wj']!.text = v(s?['w']?['jumuah']);
    c['qc']!.text = v(s?['q']?['circles']);
    c['qs']!.text = v(s?['q']?['students']);
    for (final (k, _, _) in mrFields) {
      c[k]!.text = v(s?[k]);
    }
    photos = List<String>.from((s?['photos'] as List?) ?? []);
    loadedFor = mk;
  }
  int? num_(String k) => c[k]!.text.trim().isEmpty ? null : int.tryParse(toLatin(c[k]!.text.trim()));
  Future<void> addPhotos() async {
    final xs = await ImagePicker().pickMultiImage(maxWidth: 2000, limit: 10 - photos.length);
    for (var i = 0; i < xs.length && photos.length < 10; i++) {
      setState(() => phMsg = 'جارٍ رفع الصورة ${i + 1} من ${xs.length}…');
      try {
        photos.add(await Docs.uploadPhoto(await shrinkJpeg(await xs[i].readAsBytes())));
      } catch (_) {
        setState(() => phMsg = 'تعذّر رفع إحدى الصور.');
        return;
      }
    }
    setState(() => phMsg = xs.isEmpty ? null : 'أُضيفت الصور. اضغط «إرسال» أو «حفظ» لإرفاقها بالتقرير.');
  }
  Future<void> save(bool send) async {
    if (send && c['news']!.text.trim().isEmpty) return setState(() => errs = ['اكتب أبرز المستجدات والأنشطة قبل الإرسال.']);
    final st = widget.st, me = st.me!;
    final saved = all[mk] as Map?;
    final now = DateTime.now().toUtc().toIso8601String();
    final lessons = ((st.myMonths[mk]?['l'] as Map?) ?? {}).length;
    final data = <String, dynamic>{
      'mosqueId': me['mosqueId'],
      'w': {'fajr': num_('wf'), 'daily': num_('wd'), 'jumuah': num_('wj')},
      'q': {'circles': num_('qc'), 'students': num_('qs')},
      'lessonsCount': st.myMonths.containsKey(mk) ? lessons : (saved?['lessonsCount'] ?? 0),
      'updatedAt': now,
      'status': send || saved?['status'] == 'sent' ? 'sent' : 'draft',
      for (final (k, _, _) in mrFields) k: c[k]!.text.trim(),
      'photos': photos.take(10).toList(),
    };
    if (send && saved?['sentAt'] == null) data['sentAt'] = now;
    setState(() {
      busy = true;
      errs = [];
    });
    try {
      await Docs.upsertMerge('monthly/${st.uid}', {'staffId': me['id'], 'uid': st.uid, 'reports': {mk: data}});
      await st.refresh();
      if (mounted) toast(context, data['status'] == 'sent' ? 'أُرسل التقرير إلى الإدارة.' : 'حُفظت المسودة. لم تُرسل بعد.');
    } catch (_) {
      setState(() => errs = ['تعذّر الحفظ، حاول مرة أخرى.']);
    }
    if (mounted) setState(() => busy = false);
  }
  Widget statusChip(Map? r, Map? rv) {
    if (r == null) return tagChip('لم يُرسل', cBad);
    if (rv?['status'] == 'reviewed') return tagChip('تمت المراجعة', cOk);
    if (r['status'] == 'sent') return tagChip('مُرسل · بانتظار المراجعة', cWarn);
    return tagChip('مسودة', cMuted);
  }
  @override
  Widget build(BuildContext context) {
    if (loadedFor != mk) load();
    final st = widget.st, saved = all[mk] as Map?, rv = st.reviewOf(mk), locked = rv?['status'] == 'reviewed';
    final months = <String>{};
    var d = DateTime.now();
    for (var i = 0; i < 6; i++) {
      months.add(dkey(DateTime(d.year, d.month - i, 1)).substring(0, 7));
    }
    months.addAll(all.keys);
    final ms = months.toList()..sort((a, b) => b.compareTo(a));
    Widget numF(String k, String l) => Expanded(child: TextField(controller: c[k], enabled: !locked, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: l)));
    final lessons = ((st.myMonths[mk]?['l'] as Map?) ?? {}).length;
    return ListView(padding: const EdgeInsets.all(16), children: [
      Section(title: 'التقرير الشهري للإدارة', trailing: statusChip(saved, rv), children: [
        _dd('شهر التقرير', mk, [for (final m in ms) (m, monthAr(m))], (v) => setState(() => mk = v)),
        if (locked) ...[gap(), banner('راجعت الإدارة هذا التقرير.${rv?['note'] != null && '${rv?['note']}'.isNotEmpty ? '\nملاحظة الإدارة: ${rv?['note']}' : ''}', color: cOk, icon: Icons.verified_outlined)],
        gap(16),
        const Text('متوسط عدد المصلين', style: TextStyle(fontWeight: FontWeight.w800)),
        gap(8),
        Row(children: [numF('wf', 'الفجر'), const SizedBox(width: 8), numF('wd', 'باقي الصلوات'), const SizedBox(width: 8), numF('wj', 'الجمعة')]),
        gap(16),
        const Text('تحفيظ القرآن', style: TextStyle(fontWeight: FontWeight.w800)),
        gap(8),
        Row(children: [numF('qc', 'عدد الحلقات'), const SizedBox(width: 8), numF('qs', 'عدد الطلاب')]),
        gap(10),
        Container(padding: const EdgeInsets.all(10), decoration: BoxDecoration(color: const Color(0x0F1F2A1A), borderRadius: BorderRadius.circular(10)), child: Text('الدروس المسجّلة في التطبيق لهذا الشهر: ${st.myMonths.containsKey(mk) ? lessons : (saved?['lessonsCount'] ?? 0)} · تُضاف إلى التقرير تلقائياً.')),
        for (final (k, l, h) in mrFields) ...[gap(), TextField(controller: c[k], enabled: !locked, minLines: 2, maxLines: 6, decoration: InputDecoration(labelText: l, hintText: h, alignLabelWithHint: true))],
        gap(16),
        Row(children: [Expanded(child: Text('صور من المسجد (${photos.length} / 10)', style: const TextStyle(fontWeight: FontWeight.w800))), if (!locked && photos.length < 10) TextButton.icon(onPressed: addPhotos, icon: const Icon(Icons.add_photo_alternate_outlined), label: const Text('إضافة صور'))]),
        if (photos.isNotEmpty)
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final id in photos)
              Stack(children: [
                GestureDetector(onTap: () => openPhoto(context, id), child: SizedBox(width: 92, height: 92, child: netPhoto(id))),
                if (!locked) PositionedDirectional(top: 2, end: 2, child: InkWell(onTap: () => setState(() => photos.remove(id)), child: const CircleAvatar(radius: 12, backgroundColor: Colors.black54, child: Icon(Icons.close, size: 14, color: Colors.white)))),
              ]),
          ]),
        if (phMsg != null) note(phMsg!),
        _err(errs),
        if (!locked) ...[
          gap(16),
          FilledButton(onPressed: busy ? null : () => save(true), child: Text(saved?['status'] == 'sent' ? 'تحديث التقرير المرسل' : 'إرسال إلى الإدارة')),
          if (saved?['status'] != 'sent') ...[gap(8), OutlinedButton(onPressed: busy ? null : () => save(false), child: const Text('حفظ كمسودة'))],
        ],
      ]),
    ]);
  }
}

/* ======================= MOSQUE CONDITION REPORTS ======================= */
class ReportsScreen extends StatefulWidget {
  final AppState st;
  const ReportsScreen({super.key, required this.st});
  @override
  State<ReportsScreen> createState() => _ReportsState();
}
class _ReportsState extends State<ReportsScreen> {
  String cat = reportCats.first, sev = 'low';
  final notes = TextEditingController();
  bool busy = false;
  List<String> errs = [];
  Future<void> send() async {
    if (notes.text.trim().isEmpty) return setState(() => errs = ['اكتب تفاصيل البلاغ.']);
    final st = widget.st, me = st.me!;
    setState(() {
      busy = true;
      errs = [];
    });
    try {
      final now = DateTime.now();
      await Docs.set('reports/${newId()}', {'date': dkey(now), 'createdAt': now.toUtc().toIso8601String(), 'staffId': me['id'], 'mosqueId': me['mosqueId'], 'category': cat, 'severity': sev, 'notes': notes.text.trim(), 'status': 'new', 'by': st.uid});
      notes.clear();
      await st.refresh();
      if (mounted) toast(context, 'أُرسل البلاغ إلى المديرية.');
    } catch (_) {
      setState(() => errs = ['تعذّر الإرسال، حاول مرة أخرى.']);
    }
    if (mounted) setState(() => busy = false);
  }
  @override
  Widget build(BuildContext context) => ListenableBuilder(
      listenable: widget.st,
      builder: (context, _) {
        final st = widget.st;
        return Scaffold(
          appBar: AppBar(title: const Text('بلاغ عن حال المسجد')),
          body: ListView(padding: const EdgeInsets.all(16), children: [
            Section(title: 'بلاغ جديد', children: [
              Row(children: [
                Expanded(child: _dd('الفئة', cat, [for (final c in reportCats) (c, c)], (v) => setState(() => cat = v))),
                const SizedBox(width: 10),
                Expanded(child: _dd('الأهمية', sev, [for (final e in sevLabel.entries) (e.key, e.value)], (v) => setState(() => sev = v))),
              ]),
              gap(),
              _tf(notes, 'التفاصيل', hint: 'صف المشكلة أو الاحتياج', lines: 3),
              _err(errs),
              gap(16),
              FilledButton(onPressed: busy ? null : send, child: Text(busy ? 'جارٍ الإرسال…' : 'إرسال البلاغ')),
            ]),
            gap(),
            Section(title: 'بلاغات مسجدي', children: [
              if (st.reports.isEmpty) note('لا توجد بلاغات.'),
              for (final r in st.reports.take(20))
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text('${r['category']}', style: const TextStyle(fontWeight: FontWeight.w700))),
                      () {
                        final s = st.repStatus(r);
                        return tagChip(repStatusLabel[s] ?? s, s == 'done' ? cOk : s == 'work' ? cWarn : cBad);
                      }(),
                    ]),
                    Text('${r['notes']}'),
                    note('${r['date']} · ${sevLabel[r['severity']] ?? ''}', size: 12),
                  ]),
                ),
            ]),
          ]),
        );
      });
}

/* ======================= LEAVE & SUBSTITUTE ======================= */
class LeavesScreen extends StatefulWidget {
  final AppState st;
  const LeavesScreen({super.key, required this.st});
  @override
  State<LeavesScreen> createState() => _LeavesState();
}
class _LeavesState extends State<LeavesScreen> {
  String type = leaveTypes.first, scope = 'all', sub = 'none';
  late String from = widget.st.today, to = widget.st.today;
  Set<String> pr = {};
  final subName = TextEditingController(), subPhone = TextEditingController(), reason = TextEditingController();
  bool busy = false;
  List<String> errs = [];
  @override
  void initState() {
    super.initState();
    if ('${widget.st.me?['subName'] ?? ''}'.isNotEmpty) sub = 'registered';
  }
  Future<void> pick(bool isFrom) async {
    final d = await showDatePicker(context: context, initialDate: fromKey(isFrom ? from : to), firstDate: DateTime.now().subtract(const Duration(days: 7)), lastDate: DateTime.now().add(const Duration(days: 365)));
    if (d != null) setState(() => isFrom ? from = dkey(d) : to = dkey(d));
  }
  Future<void> submit() async {
    final st = widget.st, me = st.me!;
    final e = <String>[];
    if (to.compareTo(from) < 0) {
      e.add('تاريخ النهاية يجب أن يكون بعد تاريخ البداية.');
    } else if (daysBetween(from, to) > 60) {
      e.add('أقصى مدة للطلب الواحد 60 يوماً.');
    }
    if (daysBetween(from, st.today) > 8) e.add('لا يمكن طلب إجازة لتاريخ مضى عليه أكثر من 7 أيام.');
    if (scope == 'some' && pr.isEmpty) e.add('اختر الصلوات التي تشملها الإجازة.');
    String? ph = '';
    if (sub == 'other') {
      if (subName.text.trim().isEmpty) e.add('اكتب اسم الإمام البديل.');
      ph = normPhone(subPhone.text);
      if (ph == null) e.add('رقم واتساب البديل غير صحيح.');
    }
    setState(() => errs = e);
    if (e.isNotEmpty) return;
    setState(() => busy = true);
    final ap = st.myApp ?? {};
    final item = {
      'type': type,
      'from': from,
      'to': to,
      'prayers': scope == 'all' ? 'all' : pr.toList(),
      'reason': reason.text.trim(),
      'staffId': me['id'],
      'mosqueId': me['mosqueId'],
      'createdAt': DateTime.now().toUtc().toIso8601String(),
      'subName': sub == 'registered' ? (me['subName'] ?? ap['subName'] ?? '') : sub == 'other' ? subName.text.trim() : '',
      'subPhone': sub == 'registered' ? (ap['subPhone'] ?? '') : sub == 'other' ? ph : '',
    };
    try {
      await Docs.upsertMerge('leaves/${st.uid}', {'items': {newId(): item}}, {'uid': st.uid, 'staffId': me['id']});
      reason.clear();
      await st.refresh();
      if (mounted) toast(context, 'أُرسل طلب الإجازة إلى الإدارة.');
    } catch (_) {
      setState(() => errs = ['تعذّر إرسال الطلب، حاول مرة أخرى.']);
    }
    if (mounted) setState(() => busy = false);
  }
  @override
  Widget build(BuildContext context) => ListenableBuilder(
      listenable: widget.st,
      builder: (context, _) {
        final st = widget.st, me = st.me!, year = st.today.substring(0, 4);
        final hasReg = '${me['subName'] ?? ''}'.isNotEmpty;
        return Scaffold(
          appBar: AppBar(title: const Text('طلب إجازة وبديل')),
          body: ListView(padding: const EdgeInsets.all(16), children: [
            Section(title: 'طلب إجازة', children: [
              Row(children: [
                Expanded(child: _kpi('${st.usedDays('إجازة سنوية', year)}', 'أيام سنوية معتمدة في $year')),
                Expanded(child: _kpi('${st.usedDays(null, year)}', 'كل الإجازات المعتمدة')),
              ]),
              gap(),
              _dd('نوع الإجازة', type, [for (final t in leaveTypes) (t, t)], (v) => setState(() => type = v)),
              gap(),
              Row(children: [
                Expanded(child: OutlinedButton.icon(onPressed: () => pick(true), icon: const Icon(Icons.event), label: Text('من $from'))),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton.icon(onPressed: () => pick(false), icon: const Icon(Icons.event), label: Text('إلى $to'))),
              ]),
              if (to.compareTo(from) >= 0) Padding(padding: const EdgeInsets.only(top: 6), child: note('المدة: ${daysBetween(from, to)} يوم')),
              gap(),
              _dd('تشمل', scope, [('all', 'كل الصلوات في هذه الأيام'), ('some', 'صلوات محددة فقط')], (v) => setState(() => scope = v)),
              if (scope == 'some') Wrap(spacing: 6, children: [for (final p in prayers) FilterChip(label: Text(p.n), selected: pr.contains(p.k), onSelected: (s) => setState(() => s ? pr.add(p.k) : pr.remove(p.k)))]),
              gap(),
              _dd('من يقوم مقامك؟', sub, [if (hasReg) ('registered', 'الإمام البديل المسجّل: ${me['subName']}'), ('other', 'إمام بديل آخر'), ('none', 'لا يوجد بديل')], (v) => setState(() => sub = v)),
              if (sub == 'other') ...[gap(), _tf(subName, 'اسم الإمام البديل'), gap(), _tf(subPhone, 'واتساب البديل', hint: '059xxxxxxx', kb: TextInputType.phone, dir: TextDirection.ltr)],
              gap(),
              _tf(reason, 'السبب أو ملاحظات (اختياري)', lines: 2),
              _err(errs),
              gap(16),
              FilledButton(onPressed: busy ? null : submit, child: Text(busy ? 'جارٍ الإرسال…' : 'إرسال الطلب')),
            ]),
            gap(),
            Section(title: 'طلباتي', children: [
              if (st.leaves.isEmpty) note('لا توجد طلبات بعد.'),
              for (final l in st.leaves)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Row(children: [
                      Expanded(child: Text('${l['type']}', style: const TextStyle(fontWeight: FontWeight.w700))),
                      l['cancelled'] == true
                          ? tagChip('أُلغي', cMuted)
                          : l['dec'] == null
                              ? tagChip('بانتظار الموافقة', cWarn)
                              : l['dec']['status'] == 'approved'
                                  ? tagChip('معتمدة', cOk)
                                  : tagChip('مرفوضة', cBad),
                    ]),
                    note('من ${l['from']} إلى ${l['to']} · ${daysBetween('${l['from']}', '${l['to']}')} يوم · ${l['prayers'] == 'all' || l['prayers'] == null ? 'كل الصلوات' : (l['prayers'] as List).map((k) => pPlain('$k')).join('، ')}', size: 12),
                    note('${l['subName'] != null && '${l['subName']}'.isNotEmpty ? 'البديل: ${l['subName']}' : 'دون إمام بديل'}', size: 12),
                    if (l['dec']?['note'] != null && '${l['dec']['note']}'.isNotEmpty) note('ملاحظة الإدارة: ${l['dec']['note']}', size: 12, color: cOlive),
                    if (l['dec'] == null && l['cancelled'] != true)
                      Align(
                          alignment: AlignmentDirectional.centerStart,
                          child: TextButton(
                              onPressed: () async {
                                try {
                                  await Docs.update('leaves/${st.uid}', {'items': {l['id']: {'cancelled': true}}});
                                  await st.refresh();
                                } catch (_) {}
                              },
                              child: const Text('إلغاء الطلب'))),
                  ]),
                ),
            ]),
          ]),
        );
      });
}
Widget _kpi(String n, String l) => Container(
    margin: const EdgeInsetsDirectional.only(end: 8),
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
    decoration: const BoxDecoration(border: BorderDirectional(start: BorderSide(color: cOlive, width: 3))),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(n, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)), note(l, size: 12)]));

/* ======================= HISTORY ======================= */
class HistoryScreen extends StatelessWidget {
  final AppState st;
  const HistoryScreen({super.key, required this.st});
  @override
  Widget build(BuildContext context) {
    var on = 0, late = 0, abs = 0;
    final rows = <(DateTime, List<String>)>[];
    for (var i = 0; i < 30; i++) {
      final d = DateTime.now().subtract(Duration(days: i)), k = dkey(d);
      if (!st.myMonths.containsKey(k.substring(0, 7))) continue;
      final day = st.myDay(k);
      final sts = [for (final p in prayers) st.statusOf(day[p.k] as Map?, p.k, k)];
      if (sts.every((s) => s == 'na')) continue;
      for (final s in sts) {
        if (s == 'ok') {
          on++;
        } else if (s == 'late') {
          late++;
        } else if (s == 'absent' || s == 'bad') {
          abs++;
        }
      }
      rows.add((d, sts));
    }
    return Scaffold(
      appBar: AppBar(title: const Text('سجل حضوري')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Row(children: [Expanded(child: _kpi('$on', 'في الوقت')), Expanded(child: _kpi('$late', 'متأخر')), Expanded(child: _kpi('$abs', 'غياب'))]),
        gap(),
        if (rows.isEmpty) note('لا توجد سجلات في آخر 30 يوماً.'),
        for (final (d, sts) in rows)
          Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(fmtD(d), style: const TextStyle(fontWeight: FontWeight.w700)),
                gap(6),
                Wrap(spacing: 6, runSpacing: 6, children: [for (var j = 0; j < prayers.length; j++) Row(mainAxisSize: MainAxisSize.min, children: [Text('${prayers[j].n} ', style: const TextStyle(fontSize: 12)), chip(sts[j])])]),
              ]),
            ),
          ),
      ]),
    );
  }
}
