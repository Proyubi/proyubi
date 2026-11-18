package ai.proyubi.common.web.advice;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

/**
 * 响应体日志记录
 * 记录所有 API 接口返回的数据
 *
 */
@ControllerAdvice
public class ResponseLoggingAdvice implements ResponseBodyAdvice<Object> {

    private static final Logger log = LoggerFactory.getLogger(ResponseLoggingAdvice.class);
    private static final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
        return true;
    }

    @Override
    public Object beforeBodyWrite(
        Object body,
        MethodParameter returnType,
        MediaType selectedContentType,
        Class<? extends HttpMessageConverter<?>> selectedConverterType,
        ServerHttpRequest request,
        ServerHttpResponse response
    ) {
        // 只记录 JSON 响应
        if (selectedContentType != null && selectedContentType.includes(MediaType.APPLICATION_JSON)) {
            String uri = request.getURI().getPath();
            
            // 只记录菜单接口的响应，避免日志过多
            if (uri.contains("/menu/get-menu-list-i18n") || uri.contains("/auth/me")) {
                try {
                    String jsonBody = objectMapper.writeValueAsString(body);
                    // 限制日志长度，避免过长
                    String logBody = jsonBody.length() > 2000 
                        ? jsonBody.substring(0, 2000) + "...(truncated)" 
                        : jsonBody;
                    log.info("=== API 响应数据 === URL: {} | 响应体: {}", uri, logBody);
                    
                    // 如果是 R 类型，记录详细信息
                    if (body instanceof ai.proyubi.common.core.web.R) {
                        ai.proyubi.common.core.web.R<?> r = (ai.proyubi.common.core.web.R<?>) body;
                        log.info("=== 响应结构 === code: {}, msg: {}, data类型: {}", 
                            r.getCode(), r.getMsg(), r.getData() != null ? r.getData().getClass().getSimpleName() : "null");
                    }
                } catch (JsonProcessingException e) {
                    log.warn("无法序列化响应体: {}", e.getMessage());
                }
            }
        }
        
        return body;
    }
}

