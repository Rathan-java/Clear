import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/storage.dart';
import '../data/api_client.dart';
import '../data/models.dart';
import '../data/socket_service.dart';

enum AuthStatus { unknown, signedOut, signedIn }

class AuthState {
  const AuthState({
    this.status = AuthStatus.unknown,
    this.email,
    this.userId,
    this.pairedDesktop,
    this.busy = false,
    this.error,
  });

  final AuthStatus status;
  final String? email;
  final String? userId;
  final String? pairedDesktop;
  final bool busy;
  final String? error;

  bool get isSignedIn => status == AuthStatus.signedIn;
  bool get isPaired => pairedDesktop != null;

  AuthState copyWith({
    AuthStatus? status,
    String? email,
    String? userId,
    String? pairedDesktop,
    bool? busy,
    String? error,
    bool clearError = false,
    bool clearPaired = false,
  }) =>
      AuthState(
        status: status ?? this.status,
        email: email ?? this.email,
        userId: userId ?? this.userId,
        pairedDesktop: clearPaired ? null : (pairedDesktop ?? this.pairedDesktop),
        busy: busy ?? this.busy,
        error: clearError ? null : (error ?? this.error),
      );
}

class AuthController extends StateNotifier<AuthState> {
  AuthController({
    required ApiClient api,
    required Storage storage,
    required SocketService socket,
  })  : _api = api,
        _storage = storage,
        _socket = socket,
        super(const AuthState());

  final ApiClient _api;
  final Storage _storage;
  final SocketService _socket;

  /// Called from the splash screen: silently restores a stored session.
  Future<void> restore() async {
    final token = await _storage.readRefreshToken();
    if (token == null) {
      state = state.copyWith(status: AuthStatus.signedOut);
      return;
    }

    try {
      await _api.refresh();
      state = state.copyWith(
        status: AuthStatus.signedIn,
        email: _storage.email,
        userId: _storage.userId,
        pairedDesktop: _storage.pairedDesktop,
        clearError: true,
      );
      await _socket.connect();
    } catch (error) {
      await _storage.clearSession();
      state = state.copyWith(status: AuthStatus.signedOut, error: null);
    }
  }

  Future<bool> signIn({required String email, required String password, String? backendUrl}) async {
    state = state.copyWith(busy: true, clearError: true);
    try {
      if (backendUrl != null && backendUrl.isNotEmpty && backendUrl != _storage.backendUrl) {
        await _storage.setBackendUrl(backendUrl);
      }

      final session = await _api.login(email: email, password: password);
      state = state.copyWith(
        status: AuthStatus.signedIn,
        email: session.email,
        userId: session.userId,
        pairedDesktop: _storage.pairedDesktop,
        busy: false,
        clearError: true,
      );
      await _socket.connect();
      return true;
    } on ApiException catch (error) {
      state = state.copyWith(busy: false, error: error.message);
      return false;
    } catch (error) {
      state = state.copyWith(busy: false, error: 'Something went wrong: $error');
      return false;
    }
  }

  Future<String?> pair(String code) async {
    state = state.copyWith(busy: true, clearError: true);
    try {
      final result = await _api.pair(code);
      final desktopName = (result['desktop']?['name'] ?? 'Windows PC').toString();
      await _storage.setPairedDesktop(desktopName);
      state = state.copyWith(busy: false, pairedDesktop: desktopName, clearError: true);
      await _socket.connect();
      return null;
    } on ApiException catch (error) {
      state = state.copyWith(busy: false, error: error.message);
      return error.message;
    }
  }

  /// Re-checks whether this account already has a desktop linked.
  Future<void> refreshPairing() async {
    try {
      final devices = await _api.devices();
      final desktop = devices.where((device) => device['platform'] == 'desktop').toList();
      if (desktop.isEmpty) return;
      final name = (desktop.first['name'] ?? 'Windows PC').toString();
      await _storage.setPairedDesktop(name);
      state = state.copyWith(pairedDesktop: name);
    } catch (_) {
      // Not fatal - the dashboard still works without this.
    }
  }

  Future<void> reconnect() => _socket.connect();

  Future<void> signOut() async {
    await _socket.disconnect();
    await _api.logout();
    state = const AuthState(status: AuthStatus.signedOut);
  }

  void clearError() => state = state.copyWith(clearError: true);
}
