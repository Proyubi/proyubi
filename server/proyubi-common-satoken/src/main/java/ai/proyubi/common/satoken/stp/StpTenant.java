package ai.proyubi.common.satoken.stp;

import cn.dev33.satoken.stp.StpLogic;

/**
 * 客户侧登录体系（loginType=tenant）。
 *
 * 备注：当前业务按单租户实现，但保留 tenant 语义便于后续演进。
 */
public class StpTenant {

    public static final String LOGIN_TYPE = "tenant";

    public static final StpLogic STP_LOGIC = new StpLogic(LOGIN_TYPE);

    private StpTenant() {
    }

    public static void checkLogin() {
        STP_LOGIC.checkLogin();
    }
}


