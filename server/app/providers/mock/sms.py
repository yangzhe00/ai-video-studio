"""Mock 短信 Provider：演示模式不发真实短信，验证码回传给前端展示。"""

import random


class MockSmsProvider:
    name = "mock_sms"

    def send_code(self, phone: str, code: str) -> str:
        """返回验证码本身（前端登录页提示"演示模式验证码"）。

        生产接入腾讯云/阿里云时，此处改为真实发送并返回空串。
        """
        _ = phone  # 演示模式不区分号码
        return code or str(random.randint(100000, 999999))
