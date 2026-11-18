package ai.proyubi.identity.mail;

import org.springframework.context.i18n.LocaleContextHolder;

import java.util.Locale;

/**
 * 邮件文案的语言判定 + 通用产品名。
 *
 * <p>邮件按"请求 locale 选单一语言"发送（不再固定 JA/EN 双语）。locale 已由
 * {@code I18nLocaleResolver}（X-Lang &gt; lang 参数 &gt; Accept-Language &gt; 默认 zh）解析并存入
 * {@link LocaleContextHolder}，这里只做读取与映射到 {@link Lang}。
 *
 * <p>通用产品名用于弱化品牌：无租户上下文（验证码）或租户名为空时兜底。
 */
public final class MailLocale {

    private MailLocale() {}

    public enum Lang { JA, EN, ZH }

    /** 当前请求的邮件语言；非请求线程或未解析时回退默认（ZH）。 */
    public static Lang current() {
        return of(LocaleContextHolder.getLocale());
    }

    public static Lang of(Locale locale) {
        String lang = locale == null ? "" : locale.getLanguage();
        if ("ja".equals(lang)) return Lang.JA;
        if ("en".equals(lang)) return Lang.EN;
        return Lang.ZH;
    }

    /** 通用产品名（弱化品牌），无租户名时兜底使用。 */
    public static String genericAppName(Lang lang) {
        return switch (lang) {
            case JA -> "プロジェクト管理システム";
            case EN -> "Project Management System";
            case ZH -> "项目管理系统";
        };
    }
}
