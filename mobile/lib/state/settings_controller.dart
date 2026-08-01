import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/notifications.dart';
import '../core/storage.dart';

class SettingsState {
  const SettingsState({
    required this.themeMode,
    required this.notificationsEnabled,
    required this.backendUrl,
    required this.deviceId,
  });

  final String themeMode; // system | light | dark
  final bool notificationsEnabled;
  final String backendUrl;
  final String deviceId;

  SettingsState copyWith({
    String? themeMode,
    bool? notificationsEnabled,
    String? backendUrl,
  }) =>
      SettingsState(
        themeMode: themeMode ?? this.themeMode,
        notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
        backendUrl: backendUrl ?? this.backendUrl,
        deviceId: deviceId,
      );
}

class SettingsController extends StateNotifier<SettingsState> {
  SettingsController(this._storage)
      : super(SettingsState(
          themeMode: _storage.themeMode,
          notificationsEnabled: _storage.notificationsEnabled,
          backendUrl: _storage.backendUrl,
          deviceId: _storage.deviceId,
        ));

  final Storage _storage;

  Future<void> setThemeMode(String mode) async {
    await _storage.setThemeMode(mode);
    state = state.copyWith(themeMode: mode);
  }

  Future<void> setNotifications(bool enabled) async {
    if (enabled) await NotificationService.instance.requestPermission();
    await _storage.setNotificationsEnabled(enabled);
    state = state.copyWith(notificationsEnabled: enabled);
  }

  Future<void> setBackendUrl(String url) async {
    await _storage.setBackendUrl(url);
    state = state.copyWith(backendUrl: _storage.backendUrl);
  }
}
