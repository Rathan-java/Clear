import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/notifications.dart';
import '../core/storage.dart';

class SettingsState {
  const SettingsState({
    required this.themeMode,
    required this.notificationsEnabled,
    required this.deviceId,
  });

  final String themeMode; // system | light | dark
  final bool notificationsEnabled;
  final String deviceId;

  SettingsState copyWith({String? themeMode, bool? notificationsEnabled}) => SettingsState(
        themeMode: themeMode ?? this.themeMode,
        notificationsEnabled: notificationsEnabled ?? this.notificationsEnabled,
        deviceId: deviceId,
      );
}

class SettingsController extends StateNotifier<SettingsState> {
  SettingsController(this._storage)
      : super(SettingsState(
          themeMode: _storage.themeMode,
          notificationsEnabled: _storage.notificationsEnabled,
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
}
