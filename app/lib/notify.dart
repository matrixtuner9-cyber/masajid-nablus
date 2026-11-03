import 'dart:convert';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;
import 'package:workmanager/workmanager.dart';
import 'config.dart';
import 'core.dart';

final notif = FlutterLocalNotificationsPlugin();
bool _inited = false;

const _prayerCh = AndroidNotificationDetails('prayers', 'مواقيت الصلاة',
    channelDescription: 'تنبيه عند الأذان وتذكير بتسجيل الحضور', importance: Importance.max, priority: Priority.high, icon: 'ic_stat', category: AndroidNotificationCategory.reminder);
const _msgCh = AndroidNotificationDetails('messages', 'رسائل الإدارة',
    channelDescription: 'رسائل مديرية الأوقاف وقراراتها', importance: Importance.high, priority: Priority.high, icon: 'ic_stat', category: AndroidNotificationCategory.message);

Future<void> initNotifications({void Function(String? payload)? onTap}) async {
  if (_inited) return;
  tzdata.initializeTimeZones();
  await notif.initialize(
    settings: const InitializationSettings(android: AndroidInitializationSettings('ic_stat')),
    onDidReceiveNotificationResponse: (r) => onTap?.call(r.payload),
  );
  _inited = true;
}

Future<void> requestPermissions() async {
  final a = notif.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
  try {
    await a?.requestNotificationsPermission();
  } catch (_) {}
  try {
    final can = await a?.canScheduleExactNotifications() ?? true;
    if (!can) await a?.requestExactAlarmsPermission();
  } catch (_) {}
}

Future<void> show(int id, String title, String body, {String? payload, bool prayer = false}) async {
  await notif.show(id: id, title: title, body: body, notificationDetails: NotificationDetails(android: prayer ? _prayerCh : _msgCh), payload: payload);
}

/* ---------- prayer reminders: scheduled ahead, they fire even when the app is closed ---------- */
int _pid(int day, int p, int kind) => 1000 + day * 20 + p * 2 + kind;

Future<void> schedulePrayers({required Map<String, dynamic>? me, Map? offsets, Map<String, dynamic>? leaves, Map<String, dynamic>? outDoc, Map<String, Map<String, dynamic>?> months = const {}}) async {
  final sp = await SharedPreferences.getInstance();
  final onAdhan = sp.getBool('n_adhan') ?? true, onRemind = sp.getBool('n_remind') ?? true;
  for (var d = 0; d < 4; d++) {
    for (var p = 0; p < prayers.length; p++) {
      await notif.cancel(id: _pid(d, p, 0));
      await notif.cancel(id: _pid(d, p, 1));
    }
  }
  if (me == null) return;
  final duties = me['duties'] is List ? List<String>.from(me['duties']) : prayers.map((p) => p.k).toList();
  final items = (leaves?['items'] as Map?) ?? {};
  final decs = (outDoc?['leaves'] as Map?) ?? {};
  bool onLeave(String day, String k) {
    for (final e in items.entries) {
      final l = e.value as Map, dec = decs[e.key] as Map?;
      if (l['cancelled'] == true || dec?['status'] != 'approved') continue;
      final pr = l['prayers'];
      if (day.compareTo('${l['from']}') >= 0 && day.compareTo('${l['to']}') <= 0 && (pr == 'all' || pr == null || (pr is List && pr.contains(k)))) return true;
    }
    return false;
  }
  final now = DateTime.now();
  for (var d = 0; d < 4; d++) {
    final day = DateTime(now.year, now.month, now.day + d), key = dkey(day);
    final t = prayerTimes(day, offsets);
    final rec = (months[key.substring(0, 7)]?['d'] as Map?)?[key.substring(8)] as Map?;
    for (var p = 0; p < prayers.length; p++) {
      final k = prayers[p].k;
      if (!duties.contains(k) || onLeave(key, k)) continue;
      if (rec?[k] != null) continue;
      final name = pName(k, day);
      Future<void> at(int kind, DateTime when, String title, String body) async {
        if (!when.isAfter(DateTime.now())) return;
        final tt = tz.TZDateTime.from(when.toUtc(), tz.UTC);
        try {
          await notif.zonedSchedule(id: _pid(d, p, kind), title: title, body: body, scheduledDate: tt, notificationDetails: const NotificationDetails(android: _prayerCh), androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle, payload: 'prayers');
        } catch (_) {
          await notif.zonedSchedule(id: _pid(d, p, kind), title: title, body: body, scheduledDate: tt, notificationDetails: const NotificationDetails(android: _prayerCh), androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle, payload: 'prayers');
        }
      }
      if (onAdhan) await at(0, t[k]!, 'حان وقت صلاة $name', 'التسجيل مفتوح الآن. أدخل رمز المسجد لتأكيد حضورك.');
      if (onRemind) await at(1, t[k]!.add(const Duration(minutes: 12)), 'لم تسجّل حضور $name بعد', 'يُحسب التأخير بعد $lateAfter دقيقة من الأذان.');
    }
  }
}
Future<void> cancelReminder(String k) async {
  final p = prayers.indexWhere((x) => x.k == k);
  if (p >= 0) {
    await notif.cancel(id: _pid(0, p, 1));
    await notif.cancel(id: _pid(0, p, 0));
  }
}

/* ---------- what changed since the last check: messages, decisions, reviews, approval ---------- */
Future<void> notifyChanges({required String uid, Map<String, dynamic>? thread, Map<String, dynamic>? outDoc, Map<String, dynamic>? app, Map<String, dynamic>? leaves, bool linked = false}) async {
  final sp = await SharedPreferences.getInstance();
  final prevRaw = sp.getString('sig_$uid');
  final prev = prevRaw == null ? null : jsonDecode(prevRaw) as Map<String, dynamic>;
  final sig = <String, dynamic>{
    'msg': thread?['lastFrom'] == 'admin' ? '${thread?['lastAt']}' : (prev?['msg'] ?? ''),
    'lv': {for (final e in ((outDoc?['leaves'] as Map?) ?? {}).entries) e.key: '${(e.value as Map)['status']}'},
    'rv': {for (final e in ((outDoc?['reviews'] as Map?) ?? {}).entries) e.key: '${(e.value as Map)['status']}'},
    'app': '${app?['status'] ?? ''}',
    'linked': linked,
  };
  await sp.setString('sig_$uid', jsonEncode(sig));
  if (prev == null) return; // first run: remember, do not notify
  if (sig['msg'] != '' && sig['msg'] != prev['msg']) {
    await show(2001, 'رسالة جديدة من مديرية الأوقاف', '${thread?['lastText'] ?? ''}', payload: 'messages');
  }
  final pl = (prev['lv'] as Map?) ?? {};
  final items = (leaves?['items'] as Map?) ?? {};
  for (final e in (sig['lv'] as Map).entries) {
    if (pl[e.key] != e.value) {
      final l = items[e.key] as Map?;
      await show(2100 + e.key.hashCode % 500, e.value == 'approved' ? 'اعتُمد طلب الإجازة' : 'رُفض طلب الإجازة', l == null ? '' : '${l['type']} من ${l['from']} إلى ${l['to']}', payload: 'leaves');
    }
  }
  final pr = (prev['rv'] as Map?) ?? {};
  for (final e in (sig['rv'] as Map).entries) {
    if (pr[e.key] != e.value && e.value == 'reviewed') await show(2700 + e.key.hashCode % 200, 'راجعت الإدارة تقريرك الشهري', 'تقرير ${monthAr(e.key)}', payload: 'monthly');
  }
  if (sig['linked'] == true && prev['linked'] != true) {
    await show(2950, 'تم اعتماد حسابك', 'وافقت مديرية الأوقاف على طلبك. يمكنك الآن تسجيل الحضور.', payload: 'prayers');
  } else if (sig['app'] == 'rejected' && prev['app'] != 'rejected') {
    await show(2951, 'طلب التسجيل بحاجة إلى تعديل', '${app?['reason'] ?? 'افتح التطبيق لمراجعة الطلب.'}', payload: 'home');
  }
}

/* ---------- background worker: runs about every 15 minutes even when the app is closed ---------- */
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, input) async {
    WidgetsFlutterBinding.ensureInitialized();
    try {
      await initNotifications();
      try {
        await Supabase.initialize(url: sbUrl, anonKey: sbKey);
      } catch (_) {}
      final c = Supabase.instance.client;
      var s = c.auth.currentSession;
      if (s == null) return true;
      if (s.isExpired) {
        try {
          await c.auth.refreshSession();
        } catch (_) {
          return true;
        }
      }
      final uid = c.auth.currentUser!.id;
      Future<Map<String, dynamic>?> get(String p) async {
        final r = await c.from('docs').select('data').eq('path', p).maybeSingle();
        return r == null ? null : Map<String, dynamic>.from(r['data'] as Map);
      }
      final staffRows = await c.from('docs').select('id,data').eq('coll', 'org/main/staff').eq('data->>uid', uid).limit(1);
      final me = staffRows.isEmpty ? null : {'id': staffRows.first['id'], ...Map<String, dynamic>.from(staffRows.first['data'] as Map)};
      final thread = await get('threads/$uid'), outDoc = await get('outbox/$uid'), app = await get('applications/$uid'), leaves = await get('leaves/$uid');
      await notifyChanges(uid: uid, thread: thread, outDoc: outDoc, app: app, leaves: leaves, linked: me != null);
      final settings = await get('org/main/settings/app');
      final mk = dkey(DateTime.now()).substring(0, 7);
      final months = <String, Map<String, dynamic>?>{mk: me == null ? null : await get('att/${mk}_${me['id']}')};
      await schedulePrayers(me: me, offsets: settings?['offsets'] as Map?, leaves: leaves, outDoc: outDoc, months: months);
    } catch (_) {}
    return true;
  });
}

Future<void> startBackground() async {
  try {
    await Workmanager().initialize(callbackDispatcher);
    await Workmanager().registerPeriodicTask('sync', 'sync',
        frequency: const Duration(minutes: 15), constraints: Constraints(networkType: NetworkType.connected), existingWorkPolicy: ExistingPeriodicWorkPolicy.keep);
  } catch (e) {
    debugPrint('wm $e');
  }
}
