"""种子数据：内置合成模板（FR-C-01，后端预置）。"""

from sqlalchemy.orm import Session

from app.models.entities import Template


def seed_templates(db: Session) -> None:
    """幂等写入内置模板。"""
    if db.query(Template).count() > 0:
        return
    db.add_all(
        [
            Template(
                name="简约生活风-白",
                style={
                    "intro": "纯白渐变片头 1.2s",
                    "outro": "订阅引导片尾 1.5s",
                    "subtitle": "底部居中白字黑边 32px",
                    "bgm": "轻快钢琴 / 15% 音量",
                },
            ),
            Template(
                name="知识口播风-深",
                style={
                    "intro": "深色标题卡 1s",
                    "outro": "关注卡片 1.2s",
                    "subtitle": "左侧对齐黄色关键词高亮",
                    "bgm": "科技感铺底 / 10% 音量",
                },
            ),
        ]
    )
    db.commit()
