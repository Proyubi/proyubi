package ai.proyubi.common.satoken.stp;

import cn.dev33.satoken.stp.StpLogic;

/**
 * 运营后台登录体系（loginType=platform）。
 */
public class StpPlatform {

    public static final String LOGIN_TYPE = "platform";

    public static final StpLogic STP_LOGIC = new StpLogic(LOGIN_TYPE);

    private StpPlatform() {
    }

    public static void checkLogin() {
        STP_LOGIC.checkLogin();
    }
}


