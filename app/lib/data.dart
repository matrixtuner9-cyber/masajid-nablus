import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'config.dart';
import 'core.dart';

SupabaseClient get sb => Supabase.instance.client;
String emailOf(String u) => '${u.trim().toLowerCase()}@$userDomain';

Map<String, dynamic> _m(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
dynamic _clone(dynamic v) => jsonDecode(jsonEncode(v));
String _parent(String p) => p.replaceFirst(RegExp(r'/[^/]+$'), '');
String _last(String p) => p.replaceFirst(RegExp(r'^.*/'), '');

/* ---------- document store (same layout as the directorate's web dashboard) ---------- */
class Docs {
  static Future<Map<String, dynamic>?> get(String path) async {
    final r = await sb.from('docs').select('data').eq('path', path).maybeSingle();
    return r == null ? null : _m(r['data']);
  }
  static Future<List<(String, Map<String, dynamic>)>> list(String coll, {Map<String, String>? eq}) async {
    var q = sb.from('docs').select('id,data').eq('coll', coll);
    eq?.forEach((k, v) => q = q.eq('data->>$k', v));
    final rows = await q.order('path').limit(1000);
    return [for (final r in rows) (r['id'] as String, _m(r['data']))];
  }
  static Future<void> set(String path, Map<String, dynamic> data) async {
    await sb.from('docs').upsert({'path': path, 'coll': _parent(path), 'id': _last(path), 'data': _clone(data)}, onConflict: 'path');
  }
  static Future<void> update(String path, Map<String, dynamic> patch) async {
    await sb.rpc('doc_update', params: {'p_path': path, 'p_patch': _clone(patch)});
  }
  /// merge into an existing document, or create it from base + patch
  static Future<void> upsertMerge(String path, Map<String, dynamic> patch, [Map<String, dynamic>? base]) async {
    try {
      await update(path, patch);
    } on PostgrestException catch (e) {
      if (e.code != 'P0002' && !(e.message.contains('missing'))) rethrow;
      await set(path, {...?base, ...patch});
    }
  }
  static Future<String> uploadPhoto(Uint8List bytes) async {
    final id = hexId(16);
    await sb.storage.from('photos').uploadBinary(id, bytes, fileOptions: const FileOptions(contentType: 'image/jpeg', cacheControl: '31536000'));
    return id;
  }
}

/* ---------- everything the imam's phone needs, refreshed live ---------- */
class AppState extends ChangeNotifier {
  String? uid;
  bool loading = true, loaded = false;
  String? error;
  List<Map<String, dynamic>> mosques = [], staff = [], reports = [];
  Map<String, dynamic>? settings, myApp, myThread, myOutDoc, myLeaves, myMonthly;
  Map<String, Map<String, dynamic>?> myMonths = {}, myInbox = {}, myOutbox = {};
  Map<String, Map<String, dynamic>> rstatus = {};
  Map<String, Map<String, dynamic>> askLocal = {};
  RealtimeChannel? _chan;
  Timer? _timer, _debounce;
  DateTime? lastSync;

  Map<String, dynamic>? get me => staff.cast<Map<String, dynamic>?>().firstWhere((s) => s!['uid'] == uid, orElse: () => null);
  Map<String, dynamic>? mosque(String? id) => mosques.cast<Map<String, dynamic>?>().firstWhere((m) => m!['id'] == id, orElse: () => null);
  Map<String, dynamic>? staffBy(String? id) => staff.cast<Map<String, dynamic>?>().firstWhere((s) => s!['id'] == id, orElse: () => null);
  String get today => dkey(DateTime.now());
  Map? get offsets => settings?['offsets'] as Map?;
  Map<String, DateTime> times(DateTime d) => prayerTimes(d, offsets);

  void start() {
    uid = sb.auth.currentUser?.id;
    refresh();
    _chan?.unsubscribe();
    _chan = sb.channel('docs-${uid ?? ''}').onPostgresChanges(event: PostgresChangeEvent.all, schema: 'public', table: 'docs', callback: (_) => _soon()).subscribe();
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => refresh());
  }
  void stop() {
    _chan?.unsubscribe();
    _chan = null;
    _timer?.cancel();
  }
  void _soon() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), refresh);
  }

  bool _busy = false;
  Future<void> refresh() async {
    if (uid == null || _busy) return;
    _busy = true;
    try {
      final mk = today.substring(0, 7), pk = prevMonthKey(mk);
      final r = await Future.wait([
        Docs.list('org/main/mosques'),
        Docs.list('org/main/staff'),
        Docs.get('org/main/settings/app'),
        Docs.list('org/main/rstatus'),
        Docs.get('applications/$uid'),
        Docs.get('threads/$uid'),
        Docs.get('outbox/$uid'),
        Docs.get('leaves/$uid'),
        Docs.get('monthly/$uid'),
        Docs.get('threads/$uid/m/$mk'),
        Docs.get('threads/$uid/m/$pk'),
        Docs.get('outbox/$uid/m/$mk'),
        Docs.get('outbox/$uid/m/$pk'),
      ]);
      mosques = [for (final (id, d) in r[0] as List<(String, Map<String, dynamic>)>) {'id': id, ...d}]..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
      staff = [for (final (id, d) in r[1] as List<(String, Map<String, dynamic>)>) {'id': id, ...d}];
      settings = r[2] as Map<String, dynamic>?;
      rstatus = {for (final (id, d) in r[3] as List<(String, Map<String, dynamic>)>) id: d};
      myApp = r[4] as Map<String, dynamic>?;
      myThread = r[5] as Map<String, dynamic>?;
      myOutDoc = r[6] as Map<String, dynamic>?;
      myLeaves = r[7] as Map<String, dynamic>?;
      myMonthly = r[8] as Map<String, dynamic>?;
      myInbox = {mk: r[9] as Map<String, dynamic>?, pk: r[10] as Map<String, dynamic>?};
      myOutbox = {mk: r[11] as Map<String, dynamic>?, pk: r[12] as Map<String, dynamic>?};
      final m = me;
      if (m != null) {
        final a = await Future.wait([Docs.get('att/${mk}_${m['id']}'), Docs.get('att/${pk}_${m['id']}'), if (m['mosqueId'] != null) Docs.list('reports', eq: {'mosqueId': '${m['mosqueId']}'})]);
        myMonths = {mk: a[0] as Map<String, dynamic>?, pk: a[1] as Map<String, dynamic>?};
        if (a.length > 2) {
          reports = [for (final (id, d) in a[2] as List<(String, Map<String, dynamic>)>) {'id': id, ...d}]..sort((x, y) => '${y['createdAt']}'.compareTo('${x['createdAt']}'));
        }
      } else {
        myMonths = {};
      }
      error = null;
      loaded = true;
      lastSync = DateTime.now();
    } catch (e) {
      error = 'تعذّر الاتصال بالخادم. تحقق من الإنترنت.';
      debugPrint('refresh $e');
    }
    loading = false;
    _busy = false;
    notifyListeners();
  }

  /* ---------- derived state ---------- */
  Map<String, dynamic> myDay(String dayKey) => _m(_m(myMonths[dayKey.substring(0, 7)]?['d'])[dayKey.substring(8)]);
  bool get imamUnread {
    final t = myThread;
    return t != null && t['lastFrom'] == 'admin' && (t['imamSeenAt'] == null || '${t['lastAt']}'.compareTo('${t['imamSeenAt']}') > 0);
  }
  List<Map<String, dynamic>> get messages {
    final all = <Map<String, dynamic>>[];
    for (final d in myInbox.values) {
      _m(d?['msgs']).forEach((k, v) => all.add({..._m(v), 'from': 'imam'}));
    }
    for (final d in myOutbox.values) {
      _m(d?['msgs']).forEach((k, v) => all.add({..._m(v), 'from': 'admin'}));
    }
    all.sort((a, b) => '${a['at']}'.compareTo('${b['at']}'));
    return all;
  }
  Map<String, dynamic>? leaveDecision(String id) => _m(myOutDoc?['leaves'])[id] == null ? null : _m(_m(myOutDoc?['leaves'])[id]);
  List<Map<String, dynamic>> get leaves {
    final items = _m(myLeaves?['items']);
    final res = [for (final e in items.entries) {'id': e.key, ..._m(e.value), 'dec': leaveDecision(e.key)}];
    res.sort((a, b) => '${b['createdAt']}'.compareTo('${a['createdAt']}'));
    return res;
  }
  Map<String, dynamic>? leaveOn(String dayKey, String k) {
    for (final l in leaves) {
      if (l['cancelled'] == true || l['dec'] == null || l['dec']['status'] != 'approved') continue;
      final pr = l['prayers'];
      if (dayKey.compareTo('${l['from']}') >= 0 && dayKey.compareTo('${l['to']}') <= 0 && (pr == 'all' || pr == null || (pr is List && pr.contains(k)))) return l;
    }
    return null;
  }
  int usedDays(String? type, String year) => leaves
      .where((l) => l['cancelled'] != true && l['dec']?['status'] == 'approved' && (type == null || l['type'] == type) && '${l['from']}'.startsWith(year))
      .fold(0, (n, l) => n + daysBetween('${l['from']}', '${l['to']}'));
  Map<String, dynamic>? reviewOf(String mk) => _m(myOutDoc?['reviews'])[mk] == null ? null : _m(_m(myOutDoc?['reviews'])[mk]);
  String repStatus(Map r) => '${rstatus[r['id']]?['status'] ?? 'new'}';

  String statusOf(Map? rec, String k, String dayKey) {
    final s = me;
    if (rec != null) return rec['v'] == false || rec['pv'] == false ? 'bad' : ((rec['min'] ?? 0) as num) > lateAfter ? 'late' : 'ok';
    if (s == null) return 'na';
    final duties = s['duties'];
    if (duties is List && !duties.contains(k)) return 'na';
    if (s['uid'] == null) return 'na';
    final ap = s['approvedAt'] == null ? null : DateTime.tryParse('${s['approvedAt']}');
    if (ap != null && dayKey.compareTo(dkey(ap.toLocal())) < 0) return 'na';
    if (leaveOn(dayKey, k) != null) return 'leave';
    final w = windowOf(k, times(fromKey(dayKey)));
    if (ap != null && !w.close.isAfter(ap)) return 'na';
    return DateTime.now().isBefore(w.close) ? 'pending' : 'absent';
  }

  /* ---------- photo-proof decision, taken once per prayer ---------- */
  Map<String, dynamic>? photoAsk(String k) {
    final r = myMonths[today.substring(0, 7)];
    final a = _m(_m(r?['ask'])[today.substring(8)])[k];
    if (a != null) return _m(a);
    return askLocal[today + k];
  }
  Future<void> decidePhoto(String k) async {
    if (photoAsk(k) != null) return;
    final m = me!;
    final p = _m(settings?['photo']);
    final mode = '${p['mode'] ?? 'random'}';
    final pct = num.tryParse('${p['pct'] ?? 20}') ?? 20;
    final rnd = math.Random.secure();
    final need = mode == 'always' || (mode == 'random' && rnd.nextDouble() < pct / 100);
    final ask = {'need': need, 'subject': need ? photoSubjects[rnd.nextInt(photoSubjects.length)] : '', 'at': DateTime.now().toUtc().toIso8601String()};
    askLocal[today + k] = ask;
    final mk = today.substring(0, 7);
    try {
      await Docs.upsertMerge('att/${mk}_${m['id']}', {
        'ask': {today.substring(8): {k: ask}}
      }, {'month': mk, 'staffId': m['id'], 'uid': uid, 'mosqueId': m['mosqueId']});
    } catch (e) {
      debugPrint('ask $e');
    }
  }

  /// returns null on success, or an Arabic error message
  Future<String?> checkIn(String k, String code, {String? photoId, String? photoAt, bool noPhoto = false, bool bySub = false}) async {
    final m = me;
    final mq = mosque(m?['mosqueId']);
    if (m == null || mq == null) return 'لم يُحدَّد مسجدك. راجع المديرية.';
    code = toLatin(code).replaceAll(RegExp(r'\D'), '');
    if (code.length != 6) return 'رمز المسجد 6 أرقام.';
    if (mq['codeChk'] != null && codeHash('${mq['id']}', code)[0] != mq['codeChk']) return 'الرمز غير صحيح لهذا المسجد.';
    final now = DateTime.now(), day = dkey(now), mk = day.substring(0, 7), dd = day.substring(8);
    final w = windowOf(k, times(now));
    if (now.isBefore(w.open) || !now.isBefore(w.close)) return 'وقت التسجيل لهذه الصلاة غير مفتوح الآن.';
    if (myDay(day)[k] != null) return null;
    final t = times(now);
    final pub = settings?['pubKey'] as String?;
    final payload = jsonEncode({'c': code, 't': now.toUtc().toIso8601String(), 'u': uid, 's': m['id'], 'k': k, 'day': day, 'p': photoId});
    final enc = pub == null ? null : rsaOaepEncrypt(pub, payload);
    final rec = <String, dynamic>{'at': now.toUtc().toIso8601String(), 'min': (now.difference(t[k]!).inSeconds / 60).round(), 'method': 'code', 'device': 'app', 'by': uid};
    if (enc != null) {
      rec['enc'] = enc;
    } else {
      rec['nv'] = true;
    }
    final ask = photoAsk(k);
    if (photoId != null) {
      rec['photo'] = photoId;
      rec['photoAsk'] = ask?['subject'];
      rec['photoAt'] = photoAt;
    } else if (ask?['need'] == true && noPhoto) {
      rec['noPhoto'] = true;
    }
    if (bySub) {
      rec['sub'] = true;
      rec['subName'] = m['subName'] ?? '';
    }
    try {
      await Docs.upsertMerge('att/${mk}_${m['id']}', {
        'mosqueId': mq['id'],
        'updatedAt': now.toUtc().toIso8601String(),
        'd': {dd: {k: rec}}
      }, {'month': mk, 'staffId': m['id'], 'uid': uid});
      await refresh();
      return null;
    } catch (e) {
      return 'تعذّر الحفظ، تحقق من الاتصال وحاول مرة أخرى.';
    }
  }

  Future<void> sendMsg(String text, String? photo) async {
    final now = DateTime.now().toUtc().toIso8601String(), mk = today.substring(0, 7), id = newId();
    final m = me;
    await Docs.upsertMerge('threads/$uid/m/$mk', {
      'msgs': {id: {'text': text, 'photo': photo, 'at': now, 'by': uid, 'staffId': m?['id']}}
    }, {'month': mk});
    final t = {'uid': uid, 'staffId': m?['id'], 'lastAt': now, 'lastFrom': 'imam', 'lastText': (text.isEmpty ? 'صورة مرفقة' : text).substring(0, math.min(120, (text.isEmpty ? 'صورة مرفقة' : text).length)), 'imamSeenAt': now};
    if (myThread != null) {
      await Docs.update('threads/$uid', t);
    } else {
      await Docs.set('threads/$uid', t);
    }
    await refresh();
  }
  Future<void> markSeen() async {
    if (!imamUnread) return;
    try {
      await Docs.update('threads/$uid', {'imamSeenAt': DateTime.now().toUtc().toIso8601String()});
      myThread?['imamSeenAt'] = DateTime.now().toUtc().toIso8601String();
      notifyListeners();
    } catch (_) {}
  }
}
