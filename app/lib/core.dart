import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'package:crypto/crypto.dart' as c;
import 'package:hijri/hijri_calendar.dart';
import 'package:intl/intl.dart';

/* ---------- keys and formatting ---------- */
String pad2(int n) => n.toString().padLeft(2, '0');
String dkey(DateTime d) => '${d.year}-${pad2(d.month)}-${pad2(d.day)}';
DateTime fromKey(String k) {
  final p = k.split('-').map(int.parse).toList();
  return DateTime(p[0], p[1], p[2]);
}
String prevMonthKey(String mk) {
  final p = mk.split('-').map(int.parse).toList();
  final d = DateTime(p[0], p[1] - 1, 1);
  return '${d.year}-${pad2(d.month)}';
}
String fmtT(DateTime? d) => d == null ? '—' : DateFormat('h:mm a', 'ar').format(d.toLocal());
String fmtD(DateTime d) => DateFormat('EEEE d MMMM y', 'ar').format(d);
String fmtShort(DateTime d) => DateFormat('d/M/y h:mm a', 'ar').format(d.toLocal());
String monthAr(String mk) {
  final p = mk.split('-').map(int.parse).toList();
  return DateFormat('MMMM y', 'ar').format(DateTime(p[0], p[1], 1));
}
String hijriStr(DateTime d) {
  try {
    HijriCalendar.setLocal('ar');
    final h = HijriCalendar.fromDate(d);
    return '${h.hDay} ${h.longMonthName} ${h.hYear} هـ';
  } catch (_) {
    return '';
  }
}
String uidGen() {
  final r = math.Random.secure();
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return List.generate(8, (_) => a[r.nextInt(a.length)]).join();
}
String newId() => DateTime.now().millisecondsSinceEpoch.toRadixString(36) + uidGen();
String hexId(int bytes) {
  final r = math.Random.secure();
  return List.generate(bytes, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
}
String toLatin(String v) {
  const ar = '٠١٢٣٤٥٦٧٨٩', fa = '۰۱۲۳۴۵۶۷۸۹';
  final b = StringBuffer();
  for (final ch in v.split('')) {
    final i = ar.indexOf(ch), j = fa.indexOf(ch);
    b.write(i >= 0 ? '$i' : j >= 0 ? '$j' : ch);
  }
  return b.toString();
}
String? normPhone(String v) {
  var d = toLatin(v).replaceAll(RegExp(r'[^\d+]'), '');
  if (d.startsWith('00')) d = '+${d.substring(2)}';
  if (RegExp(r'^05\d{8}$').hasMatch(d)) return '+970${d.substring(1)}';
  if (RegExp(r'^\+97[02]5\d{8}$').hasMatch(d)) return d;
  if (RegExp(r'^97[02]5\d{8}$').hasMatch(d)) return '+$d';
  return null;
}
String cleanId(String v) {
  final d = toLatin(v).replaceAll(RegExp(r'\D'), '');
  return d.length == 8 ? '0$d' : d;
}
bool validId(String v) => cleanId(v).length == 9;
bool fourPart(String v) => v.trim().split(RegExp(r'\s+')).where((x) => x.isNotEmpty).length >= 4;
bool pwOk(String p) => p.length >= 8 && RegExp(r'[A-Za-z؀-ۿ]').hasMatch(p) && RegExp(r'\d').hasMatch(p);

/* ---------- prayer times for Nablus (Egyptian authority 19.5° / 17.5°, Shafi'i Asr) ---------- */
const lat = 32.2211, lng = 35.2544;
class Prayer {
  final String k, n;
  const Prayer(this.k, this.n);
}
const prayers = [Prayer('fajr', 'الفجر'), Prayer('dhuhr', 'الظهر'), Prayer('asr', 'العصر'), Prayer('maghrib', 'المغرب'), Prayer('isha', 'العشاء')];
String pName(String k, DateTime d) => k == 'dhuhr' && d.weekday == DateTime.friday ? 'الجمعة' : prayers.firstWhere((p) => p.k == k).n;
String pPlain(String k) => prayers.firstWhere((p) => p.k == k, orElse: () => const Prayer('', '')).n;

Map<String, DateTime> rawPrayerTimes(DateTime day) {
  const dg = math.pi / 180;
  double sin(double x) => math.sin(x * dg);
  double cos(double x) => math.cos(x * dg);
  double acos(double x) => math.acos(x) / dg;
  double asin(double x) => math.asin(x) / dg;
  double atan2(double y, double x) => math.atan2(y, x) / dg;
  double fix(double a, double b) {
    a = a - b * (a / b).floorToDouble();
    return a < 0 ? a + b : a;
  }
  var y = day.year, m = day.month;
  final d = day.day;
  if (m <= 2) {
    y--;
    m += 12;
  }
  final A = (y / 100).floor(), B = 2 - A + (A / 4).floor();
  final jd = (365.25 * (y + 4716)).floor() + (30.6001 * (m + 1)).floor() + d + B - 1524.5 + 0.5 - lng / 360;
  final D = jd - 2451545, g = fix(357.529 + 0.98560028 * D, 360), q = fix(280.459 + 0.98564736 * D, 360);
  final L = fix(q + 1.915 * sin(g) + 0.020 * sin(2 * g), 360), e = 23.439 - 0.00000036 * D;
  final ra = fix(atan2(cos(e) * sin(L), cos(L)) / 15, 24), decl = asin(sin(e) * sin(L));
  final eqt = ((q / 15 - ra + 12) % 24 + 24) % 24 - 12;
  final noon = 12 - lng / 15 - eqt;
  double t(double a) => acos((-sin(a) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat))) / 15;
  final asrA = acos((sin(math.atan(1 / (1 + math.tan((lat - decl).abs() * dg))) / dg) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat))) / 15;
  final base = DateTime.utc(day.year, day.month, day.day).millisecondsSinceEpoch;
  DateTime at(double hrs) => DateTime.fromMillisecondsSinceEpoch(((base + hrs * 3600e3) / 60000).ceil() * 60000, isUtc: true).toLocal();
  return {
    'fajr': at(noon - t(19.5)),
    'sunrise': at(noon - t(0.833)),
    'dhuhr': at(noon + 2 / 60),
    'asr': at(noon + asrA),
    'maghrib': at(noon + t(0.833) + 2 / 60),
    'isha': at(noon + t(17.5)),
  };
}
Map<String, DateTime> prayerTimes(DateTime day, Map? offsets) {
  final t = rawPrayerTimes(day);
  for (final p in prayers) {
    final m = num.tryParse('${offsets?[p.k] ?? 0}') ?? 0;
    if (m != 0) t[p.k] = t[p.k]!.add(Duration(minutes: m.round()));
  }
  return t;
}
const openBefore = 20, lateAfter = 15;
class Win {
  final DateTime open, close;
  Win(this.open, this.close);
}
Win windowOf(String k, Map<String, DateTime> t) {
  final n = {'fajr': t['sunrise']!, 'dhuhr': t['asr']!, 'asr': t['maghrib']!, 'maghrib': t['isha']!, 'isha': t['isha']!.add(const Duration(minutes: 150))}[k]!;
  return Win(t[k]!.subtract(const Duration(minutes: openBefore)), n);
}
const stLabel = {'ok': 'في الوقت', 'late': 'متأخر', 'absent': 'غائب', 'pending': 'لم يحن', 'na': 'غير مكلّف', 'bad': 'مرفوض', 'open': 'التسجيل مفتوح', 'leave': 'إجازة'};

/* ---------- code check and encryption with the directorate's public key ---------- */
String sha256Hex(String s) => c.sha256.convert(utf8.encode(s)).toString();
String codeHash(String mid, String code) => sha256Hex('nablus-awqaf|$mid|${code.trim()}');

class _Der {
  final Uint8List b;
  int i = 0;
  _Der(this.b);
  (int, int, int) next() {
    final tag = b[i++];
    var len = b[i++];
    if (len & 0x80 != 0) {
      final n = len & 0x7f;
      len = 0;
      for (var j = 0; j < n; j++) {
        len = (len << 8) | b[i++];
      }
    }
    final start = i;
    return (tag, start, len);
  }
}
BigInt _big(Uint8List b) {
  var r = BigInt.zero;
  for (final x in b) {
    r = (r << 8) | BigInt.from(x);
  }
  return r;
}
/// RSA-OAEP with SHA-256 (same as WebCrypto {name:'RSA-OAEP', hash:'SHA-256'})
String? rsaOaepEncrypt(String spkiB64, String plain) {
  try {
    final der = _Der(base64.decode(spkiB64));
    der.next(); // SubjectPublicKeyInfo SEQUENCE
    final alg = der.next(); // AlgorithmIdentifier
    der.i = alg.$2 + alg.$3;
    final bits = der.next(); // BIT STRING
    der.i = bits.$2 + 1;
    der.next(); // RSAPublicKey SEQUENCE
    final mod = der.next();
    final n = _big(Uint8List.sublistView(der.b, mod.$2, mod.$2 + mod.$3));
    der.i = mod.$2 + mod.$3;
    final ex = der.next();
    final e = _big(Uint8List.sublistView(der.b, ex.$2, ex.$2 + ex.$3));
    final k = (n.bitLength + 7) ~/ 8;
    final m = utf8.encode(plain);
    const hLen = 32;
    if (m.length > k - 2 * hLen - 2) return null;
    final lHash = c.sha256.convert(<int>[]).bytes;
    final db = Uint8List(k - hLen - 1);
    db.setRange(0, hLen, lHash);
    db[k - hLen - 1 - m.length - 1] = 1;
    db.setRange(k - hLen - 1 - m.length, k - hLen - 1, m);
    final rnd = math.Random.secure();
    final seed = Uint8List.fromList(List.generate(hLen, (_) => rnd.nextInt(256)));
    Uint8List mgf1(List<int> s, int len) {
      final out = BytesBuilder();
      for (var ctr = 0; out.length < len; ctr++) {
        out.add(c.sha256.convert([...s, (ctr >> 24) & 255, (ctr >> 16) & 255, (ctr >> 8) & 255, ctr & 255]).bytes);
      }
      return Uint8List.sublistView(out.toBytes(), 0, len);
    }
    final dbMask = mgf1(seed, db.length);
    for (var j = 0; j < db.length; j++) {
      db[j] ^= dbMask[j];
    }
    final seedMask = mgf1(db, hLen);
    for (var j = 0; j < hLen; j++) {
      seed[j] ^= seedMask[j];
    }
    final em = Uint8List(k)
      ..setRange(1, 1 + hLen, seed)
      ..setRange(1 + hLen, k, db);
    final cInt = _big(em).modPow(e, n);
    final out = Uint8List(k);
    var v = cInt;
    for (var j = k - 1; j >= 0; j--) {
      out[j] = (v & BigInt.from(255)).toInt();
      v = v >> 8;
    }
    return base64.encode(out);
  } catch (_) {
    return null;
  }
}

const photoSubjects = ['المحراب', 'المنبر', 'الصف الأول من جهة المحراب', 'ساعة المسجد أو لوحة مواقيت الصلاة', 'مدخل المسجد من الداخل', 'رفوف المصاحف', 'لوحة الإعلانات'];
const roles = ['إمام', 'إمام وخطيب', 'مؤذن', 'إمام بديل', 'آذن المسجد', 'قيّم/خادم مسجد'];
const leaveTypes = ['إجازة سنوية', 'إجازة مرضية', 'إجازة طارئة', 'حج أو عمرة', 'دورة أو مهمة رسمية', 'أخرى'];
const lessonTypes = ['درس ديني', 'خطبة جمعة', 'حلقة تحفيظ', 'موعظة قصيرة', 'درس نسائي'];
const reportCats = ['النظافة', 'الصيانة والبناء', 'الكهرباء والإنارة', 'المياه والوضوء', 'السماعات والصوت', 'الفرش والسجاد', 'التدفئة والتكييف', 'أخرى'];
const sevLabel = {'low': 'عادي', 'mid': 'مهم', 'high': 'عاجل'};
const repStatusLabel = {'new': 'جديد', 'work': 'قيد المعالجة', 'done': 'مُغلق'};
int daysBetween(String a, String b) => (fromKey(b).difference(fromKey(a)).inHours / 24).round() + 1;
