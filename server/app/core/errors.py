"""统一异常与响应约定：错误体 {code, message}（与 api-client ApiError 对齐）。"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """业务异常基类：code 与前端错误处理约定一致。"""

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def install_exception_handlers(app: FastAPI) -> None:
    """注册全局异常处理器。"""

    @app.exception_handler(AppError)
    def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"code": exc.code, "message": exc.message},
        )

    @app.exception_handler(HTTPException)
    def handle_http_error(_: Request, exc: HTTPException) -> JSONResponse:
        codes = {401: "unauthorized", 404: "not_found", 403: "forbidden"}
        return JSONResponse(
            status_code=exc.status_code,
            content={"code": codes.get(exc.status_code, "error"), "message": str(exc.detail)},
        )
