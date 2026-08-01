/// Build-time defaults. Override at build time without touching code:
///   flutter build apk --release --dart-define=CLEAR_BACKEND_URL=https://your-backend
class AppConfig {
  const AppConfig._();

  static const String appName = 'Clear';
  static const String tagline = 'AI meeting assistant';

  /// 10.0.2.2 is the host machine as seen from the Android emulator.
  static const String defaultBackendUrl = String.fromEnvironment(
    'CLEAR_BACKEND_URL',
    defaultValue: 'http://10.0.2.2:8080',
  );

  static const Duration requestTimeout = Duration(seconds: 20);
  static const Duration heartbeatInterval = Duration(seconds: 15);
  static const int historyPageSize = 30;

  /// SharedPreferences / secure-storage keys.
  static const String kBackendUrl = 'backend_url';
  static const String kRefreshToken = 'refresh_token';
  static const String kEmail = 'email';
  static const String kUserId = 'user_id';
  static const String kDeviceId = 'device_id';
  static const String kThemeMode = 'theme_mode';
  static const String kNotifications = 'notifications_enabled';
  static const String kPairedDesktop = 'paired_desktop';
}
