"""Model context windows, used to budget prompts and compaction batches."""

# 只写能确认的窗口；模型名匹配不到时按 128k 保守处理，宁可早压缩也不要把请求撑爆。
WINDOWS = (
    ("deepseek", 1_000_000),
    ("gemini", 1_000_000),
    ("gpt", 400_000),
    ("o1", 200_000),
    ("o3", 200_000),
    ("o4", 200_000),
    ("claude", 200_000),
)
DEFAULT_WINDOW = 128_000


def window_for(model):
    name = (model or "").lower()
    for prefix, size in WINDOWS:
        if prefix in name:
            return size
    return DEFAULT_WINDOW
