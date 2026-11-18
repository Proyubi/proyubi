package ai.proyubi.common.web.filter;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;

/**
 * Sa-Token Header 过滤器
 * 将 Authorization header 中的 token 复制到 satoken header，以便 Sa-Token 能够读取
 *
 */
@Component
@Order(Integer.MIN_VALUE + 1) // 在 RequestLoggingFilter 之后执行
public class SaTokenHeaderFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
        throws IOException, ServletException {
        
        if (request instanceof HttpServletRequest) {
            HttpServletRequest httpRequest = (HttpServletRequest) request;
            
            // 如果存在 Authorization header 但没有 satoken header，则复制
            String authHeader = httpRequest.getHeader("Authorization");
            String satokenHeader = httpRequest.getHeader("satoken");
            
            if (authHeader != null && !authHeader.isEmpty() && (satokenHeader == null || satokenHeader.isEmpty())) {
                // 提取 token（去除 Bearer 前缀）
                String token = authHeader.startsWith("Bearer ") 
                    ? authHeader.substring(7).trim() 
                    : authHeader.trim();
                
                // 创建包装的请求，添加 satoken header
                HttpServletRequest wrappedRequest = new HttpServletRequestWrapper(httpRequest) {
                    @Override
                    public String getHeader(String name) {
                        if ("satoken".equalsIgnoreCase(name)) {
                            return token;
                        }
                        return super.getHeader(name);
                    }
                    
                    @Override
                    public Enumeration<String> getHeaders(String name) {
                        if ("satoken".equalsIgnoreCase(name)) {
                            return Collections.enumeration(Collections.singletonList(token));
                        }
                        return super.getHeaders(name);
                    }
                    
                    @Override
                    public Enumeration<String> getHeaderNames() {
                        Map<String, String> headers = new HashMap<>();
                        Enumeration<String> originalHeaders = super.getHeaderNames();
                        while (originalHeaders.hasMoreElements()) {
                            String headerName = originalHeaders.nextElement();
                            headers.put(headerName, super.getHeader(headerName));
                        }
                        if (!headers.containsKey("satoken")) {
                            headers.put("satoken", token);
                        }
                        return Collections.enumeration(headers.keySet());
                    }
                };
                
                chain.doFilter(wrappedRequest, response);
                return;
            }
        }
        
        chain.doFilter(request, response);
    }
}

