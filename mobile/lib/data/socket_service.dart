import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../core/config.dart';
import '../core/storage.dart';
import 'api_client.dart';
import 'models.dart';

enum SocketState { idle, connecting, connected, reconnecting, error }

class ConnectionStatus {
  const ConnectionStatus({
    this.state = SocketState.idle,
    this.latencyMs,
    this.presence = const Presence(),
    this.error,
    this.lastEventAt,
  });

  final SocketState state;
  final int? latencyMs;
  final Presence presence;
  final String? error;
  final DateTime? lastEventAt;

  bool get connected => state == SocketState.connected;

  ConnectionStatus copyWith({
    SocketState? state,
    int? latencyMs,
    Presence? presence,
    String? error,
    DateTime? lastEventAt,
    bool clearError = false,
    bool clearLatency = false,
  }) =>
      ConnectionStatus(
        state: state ?? this.state,
        latencyMs: clearLatency ? null : (latencyMs ?? this.latencyMs),
        presence: presence ?? this.presence,
        error: clearError ? null : (error ?? this.error),
        lastEventAt: lastEventAt ?? this.lastEventAt,
      );
}

/// Realtime link to the backend: receives answers, transcript lines and
/// presence, and measures round-trip latency with the heartbeat.
class SocketService {
  SocketService(this._api, this._storage);

  final ApiClient _api;
  final Storage _storage;

  io.Socket? _socket;
  Timer? _heartbeat;
  bool _disposed = false;
  int _authRetries = 0;

  final _answers = StreamController<Answer>.broadcast();
  final _transcripts = StreamController<TranscriptLine>.broadcast();
  final _status = StreamController<ConnectionStatus>.broadcast();

  ConnectionStatus _current = const ConnectionStatus();

  Stream<Answer> get answers => _answers.stream;
  Stream<TranscriptLine> get transcripts => _transcripts.stream;
  Stream<ConnectionStatus> get status => _status.stream;
  ConnectionStatus get current => _current;

  void _emit(ConnectionStatus next) {
    _current = next;
    if (!_status.isClosed) _status.add(next);
  }

  Future<void> connect() async {
    if (_disposed) return;
    await disconnect();

    _emit(_current.copyWith(state: SocketState.connecting, clearError: true));

    final String token;
    try {
      token = await _api.ensureToken();
    } catch (error) {
      _emit(_current.copyWith(state: SocketState.error, error: 'Sign in again to reconnect'));
      return;
    }

    final socket = io.io(
      _storage.backendUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(10000)
          .setTimeout(12000)
          .setAuth({
            'token': token,
            'platform': 'mobile',
            'deviceId': _storage.deviceId,
            'deviceName': 'Android phone',
          })
          .enableForceNew()
          .build(),
    );

    _socket = socket;

    socket.onConnect((_) {
      _authRetries = 0;
      _emit(_current.copyWith(state: SocketState.connected, clearError: true, lastEventAt: DateTime.now()));
      socket.emitWithAck(
        'mobile_connect',
        {'deviceId': _storage.deviceId, 'deviceName': 'Android phone', 'backlog': 20},
        ack: (dynamic response) {
          if (response is Map && response['presence'] != null) {
            _emit(_current.copyWith(presence: Presence.fromJson(Map<String, dynamic>.from(response['presence']))));
          }
        },
      );
      _startHeartbeat();
    });

    socket.onDisconnect((_) {
      _stopHeartbeat();
      _emit(_current.copyWith(state: SocketState.reconnecting, clearLatency: true));
    });

    socket.onConnectError((error) async {
      final message = error.toString().toLowerCase();
      final looksLikeAuth =
          message.contains('expired') || message.contains('unauthorized') || message.contains('invalid');

      // A rejected handshake usually means the access token aged out. Mint a
      // new one and rebuild the socket - bounded, so a genuinely bad session
      // cannot spin forever.
      if (looksLikeAuth && _authRetries < 2) {
        _authRetries += 1;
        try {
          await _api.refresh();
          await connect();
        } catch (_) {
          _emit(_current.copyWith(state: SocketState.error, error: 'Session expired - sign in again'));
        }
        return;
      }

      _emit(_current.copyWith(
        state: SocketState.error,
        error: looksLikeAuth ? 'Session expired - sign in again' : 'Cannot reach the server',
      ));
    });

    socket.onError((error) => _emit(_current.copyWith(error: error.toString())));

    socket.on('answer', (data) {
      if (data is Map) {
        _answers.add(Answer.fromJson(Map<String, dynamic>.from(data)));
        _emit(_current.copyWith(lastEventAt: DateTime.now()));
      }
    });

    socket.on('transcript', (data) {
      if (data is Map && data['interim'] != true) {
        _transcripts.add(TranscriptLine.fromJson(Map<String, dynamic>.from(data)));
      }
    });

    socket.on('presence', (data) {
      if (data is Map) {
        _emit(_current.copyWith(presence: Presence.fromJson(Map<String, dynamic>.from(data))));
      }
    });

    socket.on('paired', (_) => _emit(_current.copyWith(lastEventAt: DateTime.now())));

    socket.connect();
  }

  void _startHeartbeat() {
    _stopHeartbeat();
    _heartbeat = Timer.periodic(AppConfig.heartbeatInterval, (_) {
      final socket = _socket;
      if (socket == null || !socket.connected) return;
      final sentAt = DateTime.now();
      socket.emitWithAck(
        'heartbeat',
        {'t': sentAt.millisecondsSinceEpoch},
        ack: (dynamic response) {
          final rtt = DateTime.now().difference(sentAt).inMilliseconds;
          final presence = response is Map && response['presence'] != null
              ? Presence.fromJson(Map<String, dynamic>.from(response['presence']))
              : null;
          _emit(_current.copyWith(latencyMs: rtt, presence: presence, lastEventAt: DateTime.now()));
        },
      );
    });
  }

  void _stopHeartbeat() {
    _heartbeat?.cancel();
    _heartbeat = null;
  }

  Future<void> disconnect() async {
    _stopHeartbeat();
    final socket = _socket;
    if (socket != null) {
      socket.clearListeners();
      socket.dispose();
      _socket = null;
    }
    _emit(_current.copyWith(state: SocketState.idle, clearLatency: true));
  }

  void dispose() {
    _disposed = true;
    disconnect();
    _answers.close();
    _transcripts.close();
    _status.close();
  }
}
