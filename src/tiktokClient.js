import {
  ControlEvent,
  TikTokLiveConnection,
  WebcastEvent
} from "tiktok-live-connector";

export class TikTokClient {
  constructor(options) {
    this.username = options.username;
    this.reconnectDelayMs = options.reconnectDelayMs;
    this.waitForLive = options.waitForLive !== false;
    this.livePollIntervalMs = options.livePollIntervalMs || options.reconnectDelayMs;
    this.logger = options.logger;
    this.onChat = options.onChat;
    this.onStatus = options.onStatus;
    this.connection = null;
    this.reconnectTimer = null;
    this.shouldRun = false;
    this.connecting = false;
    this.connected = false;
  }

  start() {
    this.shouldRun = true;
    void this.connectOnce();
  }

  async stop() {
    this.shouldRun = false;
    this.clearReconnectTimer();

    if (this.connection) {
      try {
        await this.connection.disconnect();
      } catch (error) {
        this.logger.warn("停止 TikTok LIVE 連線時發生非致命錯誤", {
          error: error.message
        });
      }
    }
  }

  async connectOnce() {
    if (!this.shouldRun || this.connecting) {
      return;
    }

    this.connecting = true;
    this.connected = false;
    this.onStatus?.({ connected: false });

    const connection = new TikTokLiveConnection(this.username);
    this.connection = connection;
    this.bindEvents(connection);

    try {
      const state = await connection.connect();
      this.connected = true;
      this.onStatus?.({ connected: true, state });
      this.logger.info(`已連線 TikTok LIVE 公開聊天室 @${this.username}`, {
        roomId: state?.roomId || "unknown"
      });
    } catch (error) {
      this.connected = false;
      this.onStatus?.({ connected: false });

      if (isNoLiveError(error)) {
        this.logger.warn("目前未偵測到直播", {
          username: this.username
        });
        this.scheduleReconnect(this.livePollIntervalMs, "等待開播");
      } else {
        this.logger.error("TikTok LIVE 連線失敗", error, {
          username: this.username
        });
        this.scheduleReconnect(this.reconnectDelayMs, "連線失敗重試");
      }
    } finally {
      this.connecting = false;
    }
  }

  bindEvents(connection) {
    connection.on(WebcastEvent.CHAT, (data) => {
      try {
        const message = mapChatMessage(data);
        if (message.comment.trim() !== "") {
          void this.onChat?.(message);
        }
      } catch (error) {
        this.logger.error("單筆聊天室留言處理前置解析失敗", error);
      }
    });

    connection.on(ControlEvent.ERROR, ({ info, exception } = {}) => {
      this.logger.error("TikTok LIVE 連線事件錯誤", exception || new Error(String(info || "unknown")));
    });

    connection.on(ControlEvent.DISCONNECTED, ({ code, reason } = {}) => {
      this.connected = false;
      this.onStatus?.({ connected: false });
      this.logger.warn("TikTok LIVE 連線中斷", {
        code,
        reason
      });
      this.scheduleReconnect(this.reconnectDelayMs, "連線中斷重試");
    });

    connection.on("streamEnd", () => {
      this.connected = false;
      this.onStatus?.({ connected: false });
      this.logger.warn("直播已結束或目前未偵測到直播", {
        username: this.username
      });
      this.scheduleReconnect(this.livePollIntervalMs, "等待下一場直播");
    });
  }

  scheduleReconnect(delayMs = this.reconnectDelayMs, reason = "重連") {
    if (!this.shouldRun || this.reconnectTimer) {
      return;
    }

    if (!this.waitForLive && reason.includes("等待")) {
      this.logger.info("WAIT_FOR_LIVE=false，未偵測到直播時不再自動輪詢");
      return;
    }

    this.logger.info(`${reason}：將於 ${Math.round(delayMs / 1000)} 秒後重試`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectOnce();
    }, delayMs);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

function mapChatMessage(data) {
  return {
    uniqueId: data?.user?.uniqueId || data?.uniqueId || "",
    nickname: data?.user?.nickname || data?.nickname || "",
    comment: String(data?.comment || "")
  };
}

function isNoLiveError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("not live") ||
    message.includes("not currently live") ||
    message.includes("live has ended") ||
    message.includes("live ended") ||
    message.includes("offline") ||
    message.includes("user isn't online") ||
    message.includes("user is not online") ||
    message.includes("no live stream") ||
    message.includes("stream not found")
  );
}
