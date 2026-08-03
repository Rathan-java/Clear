import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../data/models.dart';

/// Heads-up notification whenever a new answer lands, so you get it even with
/// the phone face-down on the table.
class NotificationService {
  NotificationService._();

  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;
  void Function(String? answerId)? onTapped;

  static const AndroidNotificationChannel _channel = AndroidNotificationChannel(
    'clear_answers',
    'Meeting answers',
    description: 'AI answers generated during a meeting',
    importance: Importance.high,
  );

  /// Never throws: on platforms without a notification plugin (web, desktop)
  /// the app must still start, just without notifications.
  Future<void> init() async {
    if (_ready) return;

    const settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    );

    try {
      await _plugin.initialize(
        settings,
        onDidReceiveNotificationResponse: (response) => onTapped?.call(response.payload),
      );

      final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await android?.createNotificationChannel(_channel);
      _ready = true;
    } catch (error) {
      debugPrint('Notifications unavailable on this platform: $error');
    }
  }

  Future<bool> requestPermission() async {
    try {
      final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      return await android?.requestNotificationsPermission() ?? false;
    } catch (error) {
      debugPrint('Notification permission unavailable: $error');
      return false;
    }
  }

  Future<void> showAnswer(Answer answer) async {
    if (!_ready) await init();

    final title = answer.question.isNotEmpty ? answer.question : 'New answer';
    final body = answer.answer;

    try {
      await _plugin.show(
        answer.id.hashCode & 0x7fffffff,
        title.length > 70 ? '${title.substring(0, 69)}…' : title,
        body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            _channel.id,
            _channel.name,
            channelDescription: _channel.description,
            importance: Importance.high,
            priority: Priority.high,
            styleInformation: BigTextStyleInformation(
              body,
              contentTitle: title,
              summaryText: answer.summary.isNotEmpty ? answer.summary.first : null,
            ),
            category: AndroidNotificationCategory.message,
            ticker: 'Clear answer',
          ),
        ),
        payload: answer.id,
      );
    } catch (error) {
      debugPrint('Notification failed: $error');
    }
  }

  Future<void> cancelAll() => _plugin.cancelAll();
}
