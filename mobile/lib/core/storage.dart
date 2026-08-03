import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

import 'config.dart';

/// Local preferences only.
///
/// There are no tokens to look after any more: Firebase Auth persists its own
/// session in the app's private storage and refreshes it silently, so this is
/// just theme, notification and device-identity bookkeeping.
class Storage {
  Storage(this._prefs);

  final SharedPreferences _prefs;

  static Future<Storage> create() async => Storage(await SharedPreferences.getInstance());

  bool get notificationsEnabled => _prefs.getBool(AppConfig.kNotifications) ?? true;
  Future<void> setNotificationsEnabled(bool value) => _prefs.setBool(AppConfig.kNotifications, value);

  /// 'system' | 'light' | 'dark'
  String get themeMode => _prefs.getString(AppConfig.kThemeMode) ?? 'dark';
  Future<void> setThemeMode(String value) => _prefs.setString(AppConfig.kThemeMode, value);

  String? get lastEmail => _prefs.getString(AppConfig.kEmail);
  Future<void> setLastEmail(String? value) async =>
      value == null ? _prefs.remove(AppConfig.kEmail) : _prefs.setString(AppConfig.kEmail, value);

  /// Stable per-install id, so this handset shows up as one device in presence.
  String get deviceId {
    final existing = _prefs.getString(AppConfig.kDeviceId);
    if (existing != null) return existing;
    final random = Random.secure();
    final id = 'mobile-${List.generate(12, (_) => random.nextInt(16).toRadixString(16)).join()}';
    _prefs.setString(AppConfig.kDeviceId, id);
    return id;
  }
}
