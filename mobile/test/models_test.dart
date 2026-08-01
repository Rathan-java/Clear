import 'package:clear_mobile/data/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Answer', () {
    final json = {
      'id': 'a1',
      'question': 'How do we handle offline mode?',
      'answer': 'Queue locally and replay on reconnect.',
      'summary': ['Bounded queue', 'Replay on reconnect'],
      'transcript': 'So how do we handle offline mode?',
      'createdAtMs': 1735689600000,
      'latencyMs': 812,
      'model': 'gemini-2.5-flash',
      'meetingId': 'm1',
    };

    test('parses the socket payload', () {
      final answer = Answer.fromJson(json);
      expect(answer.id, 'a1');
      expect(answer.summary.length, 2);
      expect(answer.latencyMs, 812);
      expect(answer.createdAt.millisecondsSinceEpoch, 1735689600000);
    });

    test('falls back to an ISO timestamp when createdAtMs is absent', () {
      final answer = Answer.fromJson({
        'id': 'a2',
        'answer': 'Yes.',
        'createdAt': '2026-01-01T10:00:00.000Z',
      });
      expect(answer.createdAt.toUtc().year, 2026);
      expect(answer.question, isEmpty);
      expect(answer.summary, isEmpty);
    });

    test('survives a payload with nothing in it', () {
      final answer = Answer.fromJson({});
      expect(answer.answer, isEmpty);
      expect(answer.id, isNotEmpty);
    });

    test('share text carries question, answer and bullets', () {
      final text = Answer.fromJson(json).shareText;
      expect(text, contains('Q: How do we handle offline mode?'));
      expect(text, contains('Queue locally'));
      expect(text, contains('• Bounded queue'));
    });

    test('search matches question, answer and summary', () {
      final answer = Answer.fromJson(json);
      expect(answer.matches('offline'), isTrue);
      expect(answer.matches('REPLAY'), isTrue);
      expect(answer.matches('bounded'), isTrue);
      expect(answer.matches('kubernetes'), isFalse);
      expect(answer.matches('   '), isTrue);
    });
  });

  group('Presence', () {
    test('reads the desktop/mobile split', () {
      final presence = Presence.fromJson({
        'desktop': [
          {'deviceId': 'd1', 'name': 'Studio PC'}
        ],
        'mobile': [
          {'deviceId': 'm1', 'name': 'Pixel'}
        ],
      });
      expect(presence.desktopOnline, isTrue);
      expect(presence.desktops.first, 'Studio PC');
      expect(presence.mobiles.length, 1);
    });

    test('treats a missing payload as nobody online', () {
      final presence = Presence.fromJson(null);
      expect(presence.desktopOnline, isFalse);
      expect(presence.mobiles, isEmpty);
    });
  });

  group('UserSession', () {
    test('parses the login response', () {
      final session = UserSession.fromJson({
        'user': {'id': 'u1', 'email': 'a@b.c'},
        'accessToken': 'access',
        'refreshToken': 'refresh',
      });
      expect(session.userId, 'u1');
      expect(session.email, 'a@b.c');
      expect(session.copyWith(accessToken: 'new').accessToken, 'new');
      expect(session.copyWith(accessToken: 'new').refreshToken, 'refresh');
    });
  });
}
