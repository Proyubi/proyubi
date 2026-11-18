package ai.proyubi.common.web.exception;

import cn.dev33.satoken.exception.NotLoginException;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 全局异常处理（MVP 版）。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BizException.class)
    public R<Void> handleBiz(BizException e) {
        // 对于 500 错误，记录为 error 级别；其他业务异常记录为 warn 或 debug
        if (e.getCode() >= 500) {
            log.error("业务异常: code={}, message={}", e.getCode(), e.getMessage());
        } else if (e.getCode() >= 400) {
            log.warn("业务异常: code={}, message={}", e.getCode(), e.getMessage());
        } else {
            log.debug("业务异常: code={}, message={}", e.getCode(), e.getMessage());
        }
        return R.fail(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(NotLoginException.class)
    public R<Void> handleNotLogin(NotLoginException e) {
        log.debug("未登录或 token 无效: {}", e.getMessage());
        return R.fail(401, "未登录或登录已过期");
    }

    @ExceptionHandler({
        MethodArgumentNotValidException.class,
        BindException.class,
        ConstraintViolationException.class
    })
    public R<Void> handleValidation(Exception e) {
        log.warn("参数验证失败: {}", e.getMessage());
        return R.fail(400, "参数不合法");
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public R<Void> handleBody(HttpMessageNotReadableException e) {
        log.warn("请求体解析失败: {}", e.getMessage());
        return R.fail(400, "请求体解析失败");
    }

    @ExceptionHandler(Exception.class)
    public R<Void> handleUnknown(Exception e) {
        // 记录完整的异常堆栈信息，方便排查问题
        log.error("系统异常: {}", e.getMessage(), e);
        return R.fail(500, "系统错误");
    }
}


