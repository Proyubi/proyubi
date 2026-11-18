package ai.proyubi.common.web.filter;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * 请求日志过滤器
 * 记录所有进入后端的请求（包括被拦截的请求）
 * 优先级最高，确保最先执行
 *
 */
@Component
@Order(Integer.MIN_VALUE)
public class RequestLoggingFilter implements Filter {

    private static final Logger log = LoggerFactory.getLogger(RequestLoggingFilter.class);

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
        throws IOException, ServletException {
        
        if (request instanceof HttpServletRequest && response instanceof HttpServletResponse) {
            HttpServletRequest httpRequest = (HttpServletRequest) request;
            HttpServletResponse httpResponse = (HttpServletResponse) response;
            
            String method = httpRequest.getMethod();
            String uri = httpRequest.getRequestURI();
            String queryString = httpRequest.getQueryString();
            String fullUrl = queryString != null ? uri + "?" + queryString : uri;
            String remoteAddr = getClientIpAddress(httpRequest);
            String userAgent = httpRequest.getHeader("User-Agent");
            String authorization = httpRequest.getHeader("Authorization");
            
            // 记录请求信息（包括所有请求，即使被拦截）
            log.info("=== 请求进入后端 === 方法: {} | URL: {} | 客户端IP: {} | User-Agent: {} | Authorization: {}", 
                method, fullUrl, remoteAddr, 
                userAgent != null ? userAgent.substring(0, Math.min(100, userAgent.length())) : "N/A",
                authorization != null ? (authorization.length() > 20 ? authorization.substring(0, 20) + "..." : authorization) : "N/A");
            
            try {
                chain.doFilter(request, response);
                
                // 记录响应信息
                int status = httpResponse.getStatus();
                log.info("=== 请求处理完成 === 方法: {} | URL: {} | 状态码: {}", method, uri, status);
            } catch (Exception e) {
                // 记录异常信息
                log.error("=== 请求处理异常 === 方法: {} | URL: {} | 异常: {}", method, uri, e.getMessage(), e);
                throw e;
            }
        } else {
            chain.doFilter(request, response);
        }
    }

    /**
     * 获取客户端真实 IP 地址
     */
    private String getClientIpAddress(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("Proxy-Client-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("WL-Proxy-Client-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("HTTP_CLIENT_IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("HTTP_X_FORWARDED_FOR");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }
        // 处理多个 IP 的情况（X-Forwarded-For 可能包含多个 IP）
        if (ip != null && ip.contains(",")) {
            ip = ip.split(",")[0].trim();
        }
        return ip;
    }
}

