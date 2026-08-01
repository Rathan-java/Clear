import 'package:intl/intl.dart';

/// One AI answer, exactly as the backend stores and broadcasts it.
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
    this.replay = false,
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
  final bool replay;

  factory Answer.fromJson(Map<String, dynamic> json) {
    final createdMs = json['createdAtMs'];
    return Answer(
      id: (json['id'] ?? '${DateTime.now().microsecondsSinceEpoch}').toString(),
      question: (json['question'] ?? '').toString(),
      answer: (json['answer'] ?? '').toString(),
      summary: (json['summary'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      createdAt: createdMs is num
          ? DateTime.fromMillisecondsSinceEpoch(createdMs.toInt())
          : DateTime.tryParse((json['createdAt'] ?? '').toString()) ?? DateTime.now(),
      transcript: (json['transcript'] ?? '').toString(),
      latencyMs: (json['latencyMs'] as num?)?.toInt(),
      model: json['model']?.toString(),
      meetingId: json['meetingId']?.toString(),
      replay: json['replay'] == true,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'question': question,
        'answer': answer,
        'summary': summary,
        'createdAtMs': createdAt.millisecondsSinceEpoch,
        'transcript': transcript,
        'latencyMs': latencyMs,
        'model': model,
        'meetingId': meetingId,
      };

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

/// A live transcript line pushed from the desktop.
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

  factory TranscriptLine.fromJson(Map<String, dynamic> json) => TranscriptLine(
        id: (json['id'] ?? '${DateTime.now().microsecondsSinceEpoch}').toString(),
        text: (json['text'] ?? '').toString(),
        isQuestion: json['isQuestion'] == true,
        at: DateTime.tryParse((json['createdAt'] ?? json['endedAt'] ?? '').toString()) ?? DateTime.now(),
      );
}

/// Who is in the room right now, from the server's point of view.
class Presence {
  const Presence({this.desktops = const [], this.mobiles = const []});

  final List<String> desktops;
  final List<String> mobiles;

  factory Presence.fromJson(Map<String, dynamic>? json) {
    List<String> names(dynamic list) =>
        (list as List?)?.map((e) => (e is Map ? (e['name'] ?? e['deviceId'] ?? 'device') : e).toString()).toList() ??
        const [];
    return Presence(
      desktops: names(json?['desktop']),
      mobiles: names(json?['mobile']),
    );
  }

  bool get desktopOnline => desktops.isNotEmpty;
}

class UserSession {
  const UserSession({
    required this.userId,
    required this.email,
    required this.accessToken,
    required this.refreshToken,
  });

  final String userId;
  final String email;
  final String accessToken;
  final String refreshToken;

  factory UserSession.fromJson(Map<String, dynamic> json) => UserSession(
        userId: (json['user']?['id'] ?? '').toString(),
        email: (json['user']?['email'] ?? '').toString(),
        accessToken: (json['accessToken'] ?? '').toString(),
        refreshToken: (json['refreshToken'] ?? '').toString(),
      );

  UserSession copyWith({String? accessToken, String? refreshToken}) => UserSession(
        userId: userId,
        email: email,
        accessToken: accessToken ?? this.accessToken,
        refreshToken: refreshToken ?? this.refreshToken,
      );
}

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.code});

  final String message;
  final int? statusCode;
  final String? code;

  bool get isAuthError => statusCode == 401;

  @override
  String toString() => message;
}
