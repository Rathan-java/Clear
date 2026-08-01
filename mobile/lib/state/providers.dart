import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/storage.dart';
import '../data/api_client.dart';
import '../data/socket_service.dart';
import 'answers_controller.dart';
import 'auth_controller.dart';
import 'settings_controller.dart';

/// Overridden in main() once SharedPreferences has loaded.
final storageProvider = Provider<Storage>((ref) => throw UnimplementedError('storageProvider must be overridden'));

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(ref.watch(storageProvider));
  ref.onDispose(client.dispose);
  return client;
});

final socketServiceProvider = Provider<SocketService>((ref) {
  final service = SocketService(ref.watch(apiClientProvider), ref.watch(storageProvider));
  ref.onDispose(service.dispose);
  return service;
});

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(
    api: ref.watch(apiClientProvider),
    storage: ref.watch(storageProvider),
    socket: ref.watch(socketServiceProvider),
  );
});

final answersControllerProvider = StateNotifierProvider<AnswersController, AnswersState>((ref) {
  return AnswersController(
    api: ref.watch(apiClientProvider),
    socket: ref.watch(socketServiceProvider),
    storage: ref.watch(storageProvider),
  );
});

final settingsControllerProvider = StateNotifierProvider<SettingsController, SettingsState>((ref) {
  return SettingsController(ref.watch(storageProvider));
});

/// Live connection status, seeded with whatever the socket last reported.
final connectionProvider = StreamProvider<ConnectionStatus>((ref) {
  final socket = ref.watch(socketServiceProvider);
  return socket.status;
});

final connectionStatusProvider = Provider<ConnectionStatus>((ref) {
  final socket = ref.watch(socketServiceProvider);
  return ref.watch(connectionProvider).maybeWhen(
        data: (status) => status,
        orElse: () => socket.current,
      );
});

/// Live transcript lines, newest last, capped so memory stays flat.
final transcriptProvider = StreamProvider<List<String>>((ref) {
  final socket = ref.watch(socketServiceProvider);
  final lines = <String>[];
  return socket.transcripts.map((line) {
    lines.add(line.text);
    if (lines.length > 40) lines.removeAt(0);
    return List<String>.from(lines);
  });
});

final searchQueryProvider = StateProvider<String>((ref) => '');

final themeModeProvider = Provider<ThemeMode>((ref) {
  switch (ref.watch(settingsControllerProvider).themeMode) {
    case 'light':
      return ThemeMode.light;
    case 'system':
      return ThemeMode.system;
    default:
      return ThemeMode.dark;
  }
});
