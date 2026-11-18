package ai.proyubi.identity.email;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

/**
 * 邮箱验证码 DB 操作（platform_email_verification）
 */
@Mapper
public interface EmailVerificationMapper {

    @Insert("""
        INSERT INTO platform_email_verification (id, email, code_hash, purpose, expires_at)
        VALUES (#{id}, lower(#{email}), #{codeHash}, #{purpose}, #{expiresAt})
    """)
    void insert(@Param("id") UUID id,
                @Param("email") String email,
                @Param("codeHash") String codeHash,
                @Param("purpose") String purpose,
                @Param("expiresAt") OffsetDateTime expiresAt);

    /**
     * 找最近一条未消费且未过期的验证码（用于校验）
     */
    @Select("""
        SELECT id, code_hash, expires_at, attempts
        FROM platform_email_verification
        WHERE lower(email) = lower(#{email})
          AND purpose = #{purpose}
          AND consumed_at IS NULL
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
    """)
    Map<String, Object> findLatestValid(@Param("email") String email,
                                        @Param("purpose") String purpose);

    /**
     * 限流：统计指定窗口内（最近 N 秒）某邮箱+用途的验证码生成次数
     */
    @Select("""
        SELECT COUNT(*)
        FROM platform_email_verification
        WHERE lower(email) = lower(#{email})
          AND purpose = #{purpose}
          AND created_at > now() - make_interval(secs => #{windowSeconds})
    """)
    int countRecent(@Param("email") String email,
                    @Param("purpose") String purpose,
                    @Param("windowSeconds") int windowSeconds);

    @Update("""
        UPDATE platform_email_verification
        SET attempts = attempts + 1
        WHERE id = #{id}
    """)
    void incrementAttempts(@Param("id") UUID id);

    @Update("""
        UPDATE platform_email_verification
        SET consumed_at = now()
        WHERE id = #{id}
    """)
    void markConsumed(@Param("id") UUID id);
}
