import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';

DateTime _readTime(dynamic value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is int) return DateTime.fromMillisecondsSinceEpoch(value);
  if (value is String) return DateTime.tryParse(value) ?? DateTime.now();
  return DateTime.now();
}

/// One AI answer, exactly as the desktop writes it to Firestore.
class Answer {
  const Answer({
    required this.id,
    required this.question,
    required this.answer,
    required this.summary,
    required this.createdAt,
    this.transcript = '',
    this.latencyMs,
    this.model,
    this.meetingId,
  });

  final String id;
  final String question;
  final String answer;
  final List<String> summary;
  final DateTime createdAt;
  final String transcript;
  final int? latencyMs;
  final String? model;
  final String? meetingId;

  factory Answer.fromMap(String id, Map<String, dynamic> data) => Answer(
        id: id,
        question: (data['question'] ?? '').toString(),
        answer: (data['answer'] ?? '').toString(),
        summary: (data['summary'] as List?)?.map((e) => e.toString()).toList() ?? const [],
        createdAt: _readTime(data['createdAt']),
        transcript: (data['transcript'] ?? '').toString(),
        latencyMs: (data['latencyMs'] as num?)?.toInt(),
        model: data['model']?.toString(),
        meetingId: data['meetingId']?.toString(),
      );

  factory Answer.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) =>
      Answer.fromMap(doc.id, doc.data() ?? const {});

  String get title => question.isNotEmpty ? question : answer;

  String get timeLabel {
    final now = DateTime.now();
    final delta = now.difference(createdAt);
    if (delta.inSeconds < 60) return 'just now';
    if (delta.inMinutes < 60) return '${delta.inMinutes}m ago';
    if (delta.inHours < 24 && now.day == createdAt.day) return DateFormat.Hm().format(createdAt);
    if (delta.inDays < 7) return DateFormat('EEE HH:mm').format(createdAt);
    return DateFormat('d MMM, HH:mm').format(createdAt);
  }

  String get shareText => [
        if (question.isNotEmpty) 'Q: $question',
        answer,
        if (summary.isNotEmpty) '',
        ...summary.map((point) => '• $point'),
        '',
        '— via Clear',
      ].join('\n');

  bool matches(String query) {
    if (query.trim().isEmpty) return true;
    final needle = query.toLowerCase();
    return question.toLowerCase().contains(needle) ||
        answer.toLowerCase().contains(needle) ||
        summary.any((point) => point.toLowerCase().contains(needle));
  }
}

/// A transcript line, when the desktop is set to publish them.
class TranscriptLine {
  const TranscriptLine({
    required this.id,
    required this.text,
    required this.isQuestion,
    required this.at,
  });

  final String id;
  final String text;
  final bool isQuestion;
  final DateTime at;

  factory TranscriptLine.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? const {};
    return TranscriptLine(
      id: doc.id,
      text: (data['text'] ?? '').toString(),
      isQuestion: data['isQuestion'] == true,
      at: _readTime(data['createdAt']),
    );
  }
}

/// A device signed into this account, from users/{uid}/devices.
class DeviceInfo {
  const DeviceInfo({
    required this.id,
    required this.platform,
    required this.name,
    required this.lastSeenAt,
    this.listening = false,
  });

  final String id;
  final String platform;
  final String name;
  final DateTime lastSeenAt;
  final bool listening;

  factory DeviceInfo.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? const {};
    return DeviceInfo(
      id: doc.id,
      platform: (data['platform'] ?? 'unknown').toString(),
      name: (data['name'] ?? 'Device').toString(),
      lastSeenAt: _readTime(data['lastSeenAt']),
      listening: data['listening'] == true,
    );
  }

  /// The desktop heartbeats every 30s; allow three misses before calling it gone.
  bool get isOnline => DateTime.now().difference(lastSeenAt).inSeconds < 95;
}

/// Presence derived from the device documents.
class Presence {
  const Presence({this.desktops = const [], this.mobiles = const []});

  final List<DeviceInfo> desktops;
  final List<DeviceInfo> mobiles;

  factory Presence.fromDevices(List<DeviceInfo> devices) {
    final online = devices.where((device) => device.isOnline).toList();
    return Presence(
      desktops: online.where((d) => d.platform == 'desktop').toList(),
      mobiles: online.where((d) => d.platform == 'mobile').toList(),
    );
  }

  bool get desktopOnline => desktops.isNotEmpty;
  bool get desktopListening => desktops.any((d) => d.listening);
  String? get desktopName => desktops.isEmpty ? null : desktops.first.name;
}
