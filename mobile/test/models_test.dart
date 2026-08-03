import 'package:clear_mobile/data/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final createdAt = DateTime(2026, 1, 1, 10, 30);

  final data = <String, dynamic>{
    'question': 'How do we handle offline mode?',
    'answer': 'Queue locally and replay on reconnect.',
    'summary': ['Bounded queue', 'Replay on reconnect'],
    'transcript': 'So how do we handle offline mode?',
    'createdAt': createdAt,
    'latencyMs': 812,
    'model': 'gemini-2.5-flash',
    'meetingId': 'm1',
  };

  group('Answer', () {
    test('parses a Firestore document', () {
      final answer = Answer.fromMap('a1', data);
      expect(answer.id, 'a1');
      expect(answer.summary.length, 2);
      expect(answer.latencyMs, 812);
      expect(answer.createdAt, createdAt);
    });

    test('accepts a millisecond timestamp', () {
      final answer = Answer.fromMap('a2', {'answer': 'Yes.', 'createdAt': 1767261000000});
      expect(answer.createdAt.millisecondsSinceEpoch, 1767261000000);
    });

    test('accepts an ISO string timestamp', () {
      final answer = Answer.fromMap('a3', {'answer': 'Yes.', 'createdAt': '2026-01-01T10:00:00.000Z'});
      expect(answer.createdAt.toUtc().year, 2026);
    });

    test('survives an empty document', () {
      final answer = Answer.fromMap('a4', const {});
      expect(answer.answer, isEmpty);
      expect(answer.question, isEmpty);
      expect(answer.summary, isEmpty);
      expect(answer.id, 'a4');
    });

    test('share text carries question, answer and bullets', () {
      final text = Answer.fromMap('a1', data).shareText;
      expect(text, contains('Q: How do we handle offline mode?'));
      expect(text, contains('Queue locally'));
      expect(text, contains('• Bounded queue'));
    });

    test('search matches question, answer and summary', () {
      final answer = Answer.fromMap('a1', data);
      expect(answer.matches('offline'), isTrue);
      expect(answer.matches('REPLAY'), isTrue);
      expect(answer.matches('bounded'), isTrue);
      expect(answer.matches('kubernetes'), isFalse);
      expect(answer.matches('   '), isTrue);
    });

    test('falls back to the answer when there is no question', () {
      final answer = Answer.fromMap('a5', {'answer': 'Just a statement.'});
      expect(answer.title, 'Just a statement.');
    });
  });

  group('DeviceInfo', () {
    test('a fresh heartbeat counts as online', () {
      final device = DeviceInfo(
        id: 'd1',
        platform: 'desktop',
        name: 'Studio PC',
        lastSeenAt: DateTime.now().subtract(const Duration(seconds: 20)),
        listening: true,
      );
      expect(device.isOnline, isTrue);
    });

    test('a stale heartbeat counts as offline', () {
      final device = DeviceInfo(
        id: 'd2',
        platform: 'desktop',
        name: 'Studio PC',
        lastSeenAt: DateTime.now().subtract(const Duration(minutes: 5)),
      );
      expect(device.isOnline, isFalse);
    });
  });

  group('Presence', () {
    test('splits desktops from phones and ignores stale devices', () {
      final presence = Presence.fromDevices([
        DeviceInfo(
          id: 'd1',
          platform: 'desktop',
          name: 'Studio PC',
          lastSeenAt: DateTime.now(),
          listening: true,
        ),
        DeviceInfo(
          id: 'm1',
          platform: 'mobile',
          name: 'Pixel',
          lastSeenAt: DateTime.now(),
        ),
        DeviceInfo(
          id: 'd2',
          platform: 'desktop',
          name: 'Old laptop',
          lastSeenAt: DateTime.now().subtract(const Duration(hours: 2)),
        ),
      ]);

      expect(presence.desktops.length, 1);
      expect(presence.mobiles.length, 1);
      expect(presence.desktopOnline, isTrue);
      expect(presence.desktopListening, isTrue);
      expect(presence.desktopName, 'Studio PC');
    });

    test('no devices means nobody is online', () {
      final presence = Presence.fromDevices(const []);
      expect(presence.desktopOnline, isFalse);
      expect(presence.desktopListening, isFalse);
      expect(presence.desktopName, isNull);
    });
  });
}
