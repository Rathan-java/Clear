import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../core/config.dart';
import '../core/storage.dart';
import 'models.dart';

/// REST layer. Keeps the access token in memory, the refresh token in the
/// keystore, and refreshes transparently on a 401.
class ApiClient {
  ApiClient(this._storage);

  final Storage _storage;
  final http.Client _http = http.Client();

  String? _accessToken;
  Future<void>? _refreshing;

  String get baseUrl => _storage.backendUrl;

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('$baseUrl$path').replace(queryParameters: query?.isEmpty ?? true ? null : query);

  Map<String, String> _headers({bool auth = true}) => {
        'content-type': 'application/json',
        'x-device-id': _storage.deviceId,
        if (auth && _accessToken != null) 'authorization': 'Bearer $_accessToken',
      };

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? query,
    bool auth = true,
    bool retryOn401 = true,
  }) async {
    try {
      final request = http.Request(method, _uri(path, query))
        ..headers.addAll(_headers(auth: auth));
      if (body != null) request.body = jsonEncode(body);

      final streamed = await _http.send(request).timeout(AppConfig.requestTimeout);
      final response = await http.Response.fromStream(streamed);

      if (response.statusCode == 401 && auth && retryOn401) {
        await refresh();
        return _send(method, path, body: body, query: query, auth: auth, retryOn401: false);
      }

      final decoded = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
      final map = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{'data': decoded};

      if (response.statusCode >= 400) {
        throw ApiException(
          (map['message'] ?? 'Request failed (${response.statusCode})').toString(),
          statusCode: response.statusCode,
          code: map['error']?.toString(),
        );
      }
      return map;
    } on SocketException {
      throw ApiException('Cannot reach the server. Check the backend URL and your connection.');
    } on TimeoutException {
      throw ApiException('The server took too long to respond.');
    } on FormatException {
      throw ApiException('The server returned an unexpected response.');
    }
  }

  // ---- auth ---------------------------------------------------------------

  Future<UserSession> login({required String email, required String password}) async {
    final result = await _send('POST', '/login', auth: false, body: {
      'email': email,
      'password': password,
      'platform': 'mobile',
      'deviceId': _storage.deviceId,
      'deviceName': 'Android phone',
    });

    final session = UserSession.fromJson(result);
    _accessToken = session.accessToken;
    await _storage.writeRefreshToken(session.refreshToken);
    await _storage.setEmail(session.email);
    await _storage.setUserId(session.userId);
    return session;
  }

  /// Rotates the refresh token. Concurrent callers await the same future.
  Future<String> refresh() async {
    if (_refreshing != null) {
      await _refreshing;
      return _accessToken ?? (throw ApiException('Session expired', statusCode: 401));
    }

    final completer = Completer<void>();
    _refreshing = completer.future;

    try {
      final token = await _storage.readRefreshToken();
      if (token == null) throw ApiException('Signed out', statusCode: 401);

      final result = await _send('POST', '/auth/refresh', auth: false, retryOn401: false, body: {
        'refreshToken': token,
      });

      final session = UserSession.fromJson(result);
      _accessToken = session.accessToken;
      await _storage.writeRefreshToken(session.refreshToken);
      await _storage.setEmail(session.email);
      await _storage.setUserId(session.userId);
      completer.complete();
      return session.accessToken;
    } on ApiException catch (error) {
      completer.complete();
      if (error.isAuthError) await _storage.clearSession();
      rethrow;
    } finally {
      _refreshing = null;
    }
  }

  /// Returns a usable access token, refreshing if needed.
  Future<String> ensureToken() async => _accessToken ?? await refresh();

  Future<void> logout() async {
    try {
      final token = await _storage.readRefreshToken();
      await _send('POST', '/auth/logout', body: {'refreshToken': token});
    } catch (_) {
      // Signing out locally matters more than telling the server.
    }
    _accessToken = null;
    await _storage.clearSession();
  }

  // ---- pairing ------------------------------------------------------------

  Future<Map<String, dynamic>> pair(String code) => _send('POST', '/pair', body: {
        'code': code.trim().toUpperCase(),
        'deviceId': _storage.deviceId,
        'deviceName': 'Android phone',
      });

  Future<List<Map<String, dynamic>>> devices() async {
    final result = await _send('GET', '/pair/devices');
    return (result['devices'] as List? ?? []).cast<Map<String, dynamic>>();
  }

  // ---- history ------------------------------------------------------------

  Future<List<Answer>> history({int limit = AppConfig.historyPageSize, int? before, String? search}) async {
    final result = await _send('GET', '/history', query: {
      'limit': '$limit',
      if (before != null) 'before': '$before',
      if (search != null && search.isNotEmpty) 'search': search,
    });
    return (result['answers'] as List? ?? [])
        .map((json) => Answer.fromJson(json as Map<String, dynamic>))
        .toList();
  }

  Future<Map<String, dynamic>> health() => _send('GET', '/health', auth: false);

  void dispose() => _http.close();
}
