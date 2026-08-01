import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'config.dart';

/// Two-tier storage: tokens go in the Android keystore, preferences in
/// SharedPreferences. Nothing sensitive ever lands in plain preferences.
class Storage {
  Storage(this._prefs);

  final SharedPreferences _prefs;
  static const _secure = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static Future<Storage> create() async => Storage(await SharedPreferences.getInstance());

  // ---- secrets ------------------------------------------------------------

  Future<String?> readRefreshToken() => _secure.read(key: AppConfig.kRefreshToken);

  Future<void> writeRefreshToken(String? token) async {
    if (token == null) {
      await _secure.delete(key: AppConfig.kRefreshToken);
    } else {
      await _secure.write(key: AppConfig.kRefreshToken, value: token);
    }
  }

  // ---- preferences --------------------------------------------------------

  String get backendUrl => _prefs.getString(AppConfig.kBackendUrl) ?? AppConfig.defaultBackendUrl;
  Future<void> setBackendUrl(String value) =>
      _prefs.setString(AppConfig.kBackendUrl, value.replaceAll(RegExp(r'/+$'), ''));

  String? get email => _prefs.getString(AppConfig.kEmail);
  Future<void> setEmail(String? value) async =>
      value == null ? _prefs.remove(AppConfig.kEmail) : _prefs.setString(AppConfig.kEmail, value);

  String? get userId => _prefs.getString(AppConfig.kUserId);
  Future<void> setUserId(String? value) async =>
      value == null ? _prefs.remove(AppConfig.kUserId) : _prefs.setString(AppConfig.kUserId, value);

  String? get pairedDesktop => _prefs.getString(AppConfig.kPairedDesktop);
  Future<void> setPairedDesktop(String? value) async => value == null
      ? _prefs.remove(AppConfig.kPairedDesktop)
      : _prefs.setString(AppConfig.kPairedDesktop, value);

  bool get notificationsEnabled => _prefs.getBool(AppConfig.kNotifications) ?? true;
  Future<void> setNotificationsEnabled(bool value) => _prefs.setBool(AppConfig.kNotifications, value);

  /// 'system' | 'light' | 'dark'
  String get themeMode => _prefs.getString(AppConfig.kThemeMode) ?? 'dark';
  Future<void> setThemeMode(String value) => _prefs.setString(AppConfig.kThemeMode, value);

  /// Stable per-install id so the backend can recognise this handset.
  String get deviceId {
    final existing = _prefs.getString(AppConfig.kDeviceId);
    if (existing != null) return existing;
    final random = Random.secure();
    final id = 'mobile-${List.generate(12, (_) => random.nextInt(16).toRadixString(16)).join()}';
    _prefs.setString(AppConfig.kDeviceId, id);
    return id;
  }

  Future<void> clearSession() async {
    await writeRefreshToken(null);
    await setEmail(null);
    await setUserId(null);
    await setPairedDesktop(null);
  }
}
