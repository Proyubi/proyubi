package ai.proyubi.pm.service;

import ai.proyubi.pm.mapper.PmDesignFrameMapper;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * .pen 保存時の画框同期（{@link PmDesignService} の保存トランザクション内で呼ぶ）。
 * 原文の最上位 frame を upsert し、今回無かった画框は removed にする（審査ステータス・紐付けは残す）。
 *
 */
@Component
public class PmDesignFrameSyncer {

    private final PmDesignFrameMapper frameMapper;

    public PmDesignFrameSyncer(PmDesignFrameMapper frameMapper) {
        this.frameMapper = frameMapper;
    }

    public void sync(UUID tenantId, UUID designId, int revision, List<PmDesignContent.PenFrame> frames) {
        for (int i = 0; i < frames.size(); i++) {
            PmDesignContent.PenFrame f = frames.get(i);
            frameMapper.upsertSeen(tenantId, designId, f.nodeId(), f.name(), i, revision);
        }
        frameMapper.markMissingRemoved(tenantId, designId, revision);
    }
}
