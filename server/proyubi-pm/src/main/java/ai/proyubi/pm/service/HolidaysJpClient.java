package ai.proyubi.pm.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

/**
 * 日本祝日数据源客户端：holidays-jp（GitHub Pages，UTF-8 JSON）。
 * <p>
 * 端点 {@code https://holidays-jp.github.io/api/v1/date.json} 返回扁平对象
 * {@code {"2026-05-06":"憲法記念日 振替休日", ...}}（含振替休日 / 国民の休日），MIT 协议、CDN 托管。
 * 滚动 3 年窗口（去年/今年/明年）。拉取失败抛异常，由调用方决定「不清表、保留上次结果」。
 *
 */
@Slf4j
@Component
public class HolidaysJpClient {

    /** 可被 .env 覆盖（默认官方 holidays-jp） */
    @Value("${pm.holiday.jp-source-url:https://holidays-jp.github.io/api/v1/date.json}")
    private String sourceUrl;

    private final HttpClient httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 拉取并解析日本祝日：日期升序的 {@code LocalDate -> 祝日名}。
     *
     * @throws Exception 网络/解析失败（调用方应捕获并保留旧数据）
     */
    public Map<LocalDate, String> fetch() throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(sourceUrl))
            .timeout(Duration.ofSeconds(15))
            .header("Accept", "application/json")
            .GET()
            .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new IllegalStateException("holidays-jp 拉取失败 status=" + response.statusCode());
        }
        Map<String, String> raw = objectMapper.readValue(
            response.body(), new TypeReference<LinkedHashMap<String, String>>() {});
        if (raw.isEmpty()) {
            throw new IllegalStateException("holidays-jp 返回空数据");
        }
        // 滚动 3 年窗口（去年/今年/明年）：与同步的 removed 判定范围一致，避免把更早/更晚年份的
        // 上游数据当作「窗口内被撤销」误删，也压缩每租户同步处理量。
        int thisYear = LocalDate.now().getYear();
        int minYear = thisYear - 1;
        int maxYear = thisYear + 1;
        Map<LocalDate, String> out = new TreeMap<>();
        for (Map.Entry<String, String> e : raw.entrySet()) {
            try {
                LocalDate d = LocalDate.parse(e.getKey());
                if (d.getYear() < minYear || d.getYear() > maxYear) {
                    continue;
                }
                out.put(d, e.getValue());
            } catch (Exception ignore) {
                log.warn("holidays-jp 跳过非法日期 key={}", e.getKey());
            }
        }
        return out;
    }
}
