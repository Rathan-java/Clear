import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../../data/models.dart';

/// One answer. Tap to expand the transcript it came from, long-press to copy.
class AnswerCard extends StatefulWidget {
  const AnswerCard({
    super.key,
    required this.answer,
    this.highlight = false,
    this.query = '',
  });

  final Answer answer;
  final bool highlight;
  final String query;

  @override
  State<AnswerCard> createState() => _AnswerCardState();
}

class _AnswerCardState extends State<AnswerCard> {
  bool _expanded = false;

  Future<void> _copy() async {
    await Clipboard.setData(ClipboardData(text: widget.answer.shareText));
    if (!mounted) return;
    HapticFeedback.selectionClick();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Answer copied'), duration: Duration(seconds: 2)),
    );
  }

  Future<void> _share() async {
    await Share.share(
      widget.answer.shareText,
      subject: widget.answer.question.isNotEmpty ? widget.answer.question : 'Clear answer',
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final answer = widget.answer;

    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: widget.highlight ? scheme.primary.withValues(alpha: 0.6) : scheme.outlineVariant.withValues(alpha: 0.4),
          width: widget.highlight ? 1.6 : 1,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => setState(() => _expanded = !_expanded),
        onLongPress: _copy,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 12, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (answer.question.isNotEmpty) ...[
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.help_outline, size: 18, color: scheme.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _Highlighted(
                        text: answer.question,
                        query: widget.query,
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                          color: scheme.primary,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
              ],

              _Highlighted(
                text: answer.answer,
                query: widget.query,
                style: const TextStyle(fontSize: 15.5, height: 1.5),
              ),

              if (answer.streaming) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(strokeWidth: 1.8, color: scheme.primary),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'still writing…',
                      style: TextStyle(fontSize: 12, color: scheme.primary, fontStyle: FontStyle.italic),
                    ),
                  ],
                ),
              ],

              if (answer.summary.isNotEmpty) ...[
                const SizedBox(height: 12),
                ...answer.summary.map(
                  (point) => Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(top: 7, right: 9),
                          child: Container(
                            width: 5,
                            height: 5,
                            decoration: BoxDecoration(color: scheme.primary, shape: BoxShape.circle),
                          ),
                        ),
                        Expanded(
                          child: Text(
                            point,
                            style: TextStyle(fontSize: 13.5, color: scheme.onSurfaceVariant, height: 1.4),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],

              if (_expanded && answer.transcript.isNotEmpty) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainerHighest.withValues(alpha: 0.35),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'HEARD',
                        style: TextStyle(
                          fontSize: 10.5,
                          letterSpacing: 1,
                          fontWeight: FontWeight.w700,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        answer.transcript,
                        style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant, height: 1.4),
                      ),
                    ],
                  ),
                ),
              ],

              const SizedBox(height: 6),
              Row(
                children: [
                  Text(
                    answer.timeLabel,
                    style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                  ),
                  if (answer.latencyMs != null) ...[
                    const SizedBox(width: 8),
                    Text('·', style: TextStyle(color: scheme.onSurfaceVariant)),
                    const SizedBox(width: 8),
                    Text(
                      '${answer.latencyMs} ms',
                      style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                  ],
                  const Spacer(),
                  IconButton(
                    onPressed: _copy,
                    icon: const Icon(Icons.copy_rounded, size: 19),
                    tooltip: 'Copy',
                    visualDensity: VisualDensity.compact,
                  ),
                  IconButton(
                    onPressed: _share,
                    icon: const Icon(Icons.ios_share_rounded, size: 19),
                    tooltip: 'Share',
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Highlights search matches without pulling in a rich-text dependency.
class _Highlighted extends StatelessWidget {
  const _Highlighted({required this.text, required this.query, this.style});

  final String text;
  final String query;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    if (query.trim().isEmpty) return Text(text, style: style);

    final scheme = Theme.of(context).colorScheme;
    final needle = query.toLowerCase();
    final haystack = text.toLowerCase();
    final spans = <TextSpan>[];

    var index = 0;
    while (index < text.length) {
      final match = haystack.indexOf(needle, index);
      if (match < 0) {
        spans.add(TextSpan(text: text.substring(index)));
        break;
      }
      if (match > index) spans.add(TextSpan(text: text.substring(index, match)));
      spans.add(TextSpan(
        text: text.substring(match, match + needle.length),
        style: TextStyle(backgroundColor: scheme.primary.withValues(alpha: 0.28), fontWeight: FontWeight.w700),
      ));
      index = match + needle.length;
    }

    return Text.rich(TextSpan(children: spans), style: style);
  }
}
