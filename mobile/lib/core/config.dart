/// App-wide constants.
///
/// There is deliberately no backend URL here: the app talks to Firebase, and
/// the project is identified by android/app/google-services.json at build time.
class AppConfig {
  const AppConfig._();

  static const String appName = 'Clear';
  static const String tagline = 'AI meeting assistant';
  static const String version = '1.0.0';

  static const int answerPageSize = 50;

  /// SharedPreferences keys.
  static const String kEmail = 'last_email';
  static const String kDeviceId = 'device_id';
  static const String kThemeMode = 'theme_mode';
  static const String kNotifications = 'notifications_enabled';
}
