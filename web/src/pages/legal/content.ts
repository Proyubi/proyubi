export type LegalDocumentKind = "privacy" | "terms";

type LegalSection = {
  title: string;
  body: string;
};

type LegalDocument = {
  title: string;
  lastUpdated: string;
  summary: string;
  backToLogin: string;
  sections: LegalSection[];
};

type LegalLocaleContent = Record<LegalDocumentKind, LegalDocument>;

const LEGAL_CONTENT: Record<string, LegalLocaleContent> = {
  "ja-JP": {
    privacy: {
      title: "プライバシーポリシー",
      lastUpdated: "最終更新日: 2026年7月21日",
      backToLogin: "ログイン画面へ戻る",
      summary:
        "本サービスでは、プロジェクト管理とチームコラボレーションに必要な範囲で情報を取り扱います。以下に、取得する情報、その利用目的、保管方法、お客様の権利を記載します。",
      sections: [
        {
          title: "1. 収集する情報",
          body:
            "アカウント作成時にご提供いただく情報（メールアドレス、表示名、ログイン識別子）を収集します。また、サービス利用に伴い、プロジェクト、タスク、コメント、担当者、期日、添付ファイル、通知設定、操作ログなどの業務データを保存します。障害対応とセキュリティ確保のため、利用端末情報、IP アドレス、ブラウザ情報、アクセス時刻などの技術情報を記録する場合があります。",
        },
        {
          title: "2. 情報の利用目的",
          body:
            "取得した情報は、本人認証、プロジェクト管理機能の提供、チーム内共有、通知配信、問い合わせ対応、不正利用防止、障害解析、機能改善のために利用します。お客様の個人情報を、広告配信や第三者への販売を目的として利用することはありません。",
        },
        {
          title: "3. チーム内での情報共有",
          body:
            "本サービスはチームでの共同利用を前提としています。同一テナントまたは同一チームに所属するメンバーには、権限設定に応じて、プロジェクト名、タスク内容、進捗、コメント、担当者情報などが表示される場合があります。公開範囲は、管理者による権限設定またはシステム仕様に従います。",
        },
        {
          title: "4. 第三者提供と業務委託",
          body:
            "当社は、サービス提供に必要な範囲で、インフラ、認証、監視、通知配信、ファイル保存等の委託先を利用する場合があります。これらの委託先には、契約上および運用上、適切な安全管理を求めます。法令に基づく開示義務がある場合を除き、お客様の情報を無関係な第三者へ提供しません。",
        },
        {
          title: "5. データの保管とセキュリティ",
          body:
            "当社は、アクセス制御、通信の暗号化、認証管理、ログ監査、レート制限その他の合理的な安全対策を講じます。ただし、インターネット通信やクラウドサービスの性質上、完全な安全性を保証するものではありません。添付ファイルを含むデータは、サービス提供に必要な期間、当社または委託先の管理環境に保管されます。",
        },
        {
          title: "6. Cookie 等の利用",
          body:
            "本サービスでは、ログイン状態の維持、言語設定の保持、セキュリティ確保、利用状況の把握のために Cookie または同等の技術を利用する場合があります。これらは主としてサービス提供と改善のために用いられ、広告目的のクロスサイト追跡を主目的とするものではありません。",
        },
        {
          title: "7. データ保持と削除",
          body:
            "アカウント情報およびプロジェクト関連データは、サービス提供、法令対応、監査、紛争対応に必要な期間保持します。退会または削除依頼があった場合、当社は合理的な範囲で削除または匿名化を行いますが、法令上の保存義務、バックアップ、監査ログ等により直ちに完全削除できない場合があります。",
        },
        {
          title: "8. お客様の権利",
          body:
            "お客様は、ご自身に関する情報について、確認、訂正、削除、利用停止を求めることができます。ただし、チーム共有データや法令上保存が必要な情報については、全部または一部の対応が制限される場合があります。ご要望は、当社が別途案内する窓口にて受け付けます。",
        },
        {
          title: "9. ポリシーの変更",
          body:
            "本ポリシーは、法令変更やサービス内容の変更に応じて改定される場合があります。重要な変更がある場合は、サービス内表示その他の適切な方法で通知します。改定後に本サービスを利用された場合、変更後の内容に同意したものとみなします。",
        },
      ],
    },
    terms: {
      title: "利用規約",
      lastUpdated: "最終更新日: 2026年7月21日",
      backToLogin: "ログイン画面へ戻る",
      summary:
        "本規約は、当社が提供するプロジェクト管理 Web サービスの利用条件を定めるものです。利用前にご確認ください。",
      sections: [
        {
          title: "1. 規約への同意",
          body:
            "お客様が本サービスにアクセスし、登録し、または利用した時点で、本規約に同意したものとみなします。本規約に同意いただけない場合は、本サービスを利用しないでください。",
        },
        {
          title: "2. サービスの内容",
          body:
            "本サービスは、プロジェクト、タスク、進捗、担当者、期限、コメント、添付資料その他の情報を管理・共有するための Web ベースのプロジェクト管理サービスです。当社は、サービス内容の追加、変更、中断、終了を行うことがあります。",
        },
        {
          title: "3. アカウント管理",
          body:
            "アカウント情報の正確性と認証情報の管理は、お客様の責任とします。お客様のアカウントを用いて行われた行為は、第三者による不正利用が合理的に認められる場合を除き、お客様自身の行為とみなされます。認証情報の漏えいが疑われる場合は、直ちに必要な措置を講じてください。",
        },
        {
          title: "4. チーム利用と管理者権限",
          body:
            "本サービスでは、チームまたはテナントの管理者が、メンバー招待、権限設定、閲覧範囲設定、データ管理等を行うことがあります。お客様がチームに参加している場合、管理者の設定に従い、一定のデータが閲覧または管理されることがあります。",
        },
        {
          title: "5. 禁止事項",
          body:
            "お客様は、法令または公序良俗に反する行為、不正アクセス、他者のアカウント利用、サービス運営の妨害、リバースエンジニアリング、権限なく第三者の情報を収集・公開する行為、ウイルスその他有害なコードの送信を行ってはなりません。",
        },
        {
          title: "6. お客様データ",
          body:
            "お客様は、本サービスに登録・送信するコンテンツについて、必要な権利を有し、第三者の権利を侵害しないことを保証するものとします。お客様データの権利は原則としてお客様または正当な権利者に帰属しますが、当社はサービス提供、保守、改善に必要な範囲で当該データを利用できます。",
        },
        {
          title: "7. サービス提供と変更",
          body:
            "当社は、保守、障害対応、機能改善、セキュリティ対応その他の理由により、本サービスの全部または一部を一時停止することがあります。当社は、合理的な範囲で安定運用に努めますが、常時稼働や完全な無障害を保証するものではありません。",
        },
        {
          title: "8. 知的財産権",
          body:
            "本サービスに関するソフトウェア、画面、ロゴ、文書、デザイン、ノウハウその他の知的財産権は、当社または正当な権利者に帰属します。本規約に基づく利用許諾は、本サービスを利用するための限定的、非独占的、譲渡不能な権利に限られます。",
        },
        {
          title: "9. 免責",
          body:
            "当社は、本サービスを現状有姿で提供し、特定目的適合性、完全性、正確性、継続性、第三者権利非侵害について明示または黙示を問わず保証しません。プロジェクト判断、納期管理、人的配置その他の業務上の意思決定は、お客様自身の責任で行ってください。",
        },
        {
          title: "10. 責任の制限",
          body:
            "当社は、当社に故意または重過失がある場合を除き、本サービスの利用または利用不能に起因して生じた間接損害、特別損害、逸失利益、データ消失、事業中断について責任を負いません。法令上許容される範囲で、当社の損害賠償責任は、直近 12 か月間にお客様が当社へ支払った利用料の総額を上限とします。",
        },
        {
          title: "11. 利用停止・終了および規約変更",
          body:
            "お客様が本規約に違反した場合、当社は事前通知なく本サービスの利用を停止または終了できるものとします。当社は必要に応じて本規約を変更することがあり、重要な変更はサービス内表示その他の適切な方法で通知します。変更後に本サービスを利用した場合、変更後の規約に同意したものとみなします。",
        },
      ],
    },
  },
  "en-US": {
    privacy: {
      title: "Privacy Policy",
      lastUpdated: "Last updated: July 21, 2026",
      backToLogin: "Back to login",
      summary:
        "We handle information only to the extent needed to operate the project management service and support team collaboration. This policy explains what we collect, why we use it, how it is stored, and what rights users have.",
      sections: [
        {
          title: "1. Information we collect",
          body:
            "We collect account information you provide when registering, such as your email address, display name, and login identifier. We also store service data created through use of the product, including projects, tasks, comments, assignees, due dates, attachments, notification settings, and activity logs. For security and troubleshooting, we may record technical information such as IP address, browser information, device information, and access timestamps.",
        },
        {
          title: "2. How we use information",
          body:
            "We use collected information to authenticate users, provide project management features, enable team collaboration, send notifications, respond to support requests, prevent abuse, diagnose incidents, and improve the service. We do not sell personal information or use it for unrelated advertising purposes.",
        },
        {
          title: "3. Sharing within teams",
          body:
            "This service is designed for collaborative team use. Depending on permissions and tenant settings, members of the same team or tenant may be able to view project names, task details, progress, comments, assignee information, and related work data. Visibility is controlled by system behavior and administrator-managed permissions.",
        },
        {
          title: "4. Service providers and disclosures",
          body:
            "We may use third-party providers for infrastructure, authentication, monitoring, notifications, and file storage as needed to operate the service. We require appropriate security and confidentiality measures from those providers. Except where required by law, we do not disclose user information to unrelated third parties.",
        },
        {
          title: "5. Storage and security",
          body:
            "We use reasonable safeguards such as access controls, encrypted transport, authentication management, audit logging, and rate limiting. However, no internet or cloud-based system can be guaranteed completely secure. Data, including attachments, may be stored in our systems or in the systems of our service providers for as long as needed to operate the service.",
        },
        {
          title: "6. Cookies and similar technologies",
          body:
            "We may use cookies or similar technologies to keep users signed in, remember language preferences, improve security, and understand service usage. These technologies are used primarily to provide and improve the service, not for cross-site advertising tracking as a primary purpose.",
        },
        {
          title: "7. Retention and deletion",
          body:
            "Account information and project-related data are retained for as long as necessary to provide the service, meet legal obligations, support audits, and resolve disputes. When users request account closure or deletion, we will delete or anonymize data within a reasonable scope, except where immediate full deletion is not possible because of legal obligations, backups, or audit logs.",
        },
        {
          title: "8. Your rights",
          body:
            "Users may request access to, correction of, deletion of, or restriction of the use of their personal information. Requests may be limited where the information is part of shared team data or must be retained for legal or operational reasons. Requests can be made through the support channel separately designated by us.",
        },
        {
          title: "9. Changes to this policy",
          body:
            "We may update this policy to reflect legal, operational, or product changes. If a material change is made, we will provide notice through the service or another appropriate method. Continued use of the service after an update means the updated policy applies.",
        },
      ],
    },
    terms: {
      title: "Terms of Service",
      lastUpdated: "Last updated: July 21, 2026",
      backToLogin: "Back to login",
      summary:
        "These terms govern the use of our web-based project management service. Please review them before using the service.",
      sections: [
        {
          title: "1. Acceptance of terms",
          body:
            "By accessing, registering for, or using the service, you agree to these Terms of Service. If you do not agree, do not use the service.",
        },
        {
          title: "2. Service description",
          body:
            "The service is a web-based project management product for managing and sharing projects, tasks, progress, assignees, deadlines, comments, attachments, and related work information. We may add, modify, suspend, or discontinue parts of the service from time to time.",
        },
        {
          title: "3. Account responsibility",
          body:
            "You are responsible for providing accurate account information and for maintaining the confidentiality of your login credentials. Activity performed through your account will be treated as your activity unless unauthorized use is reasonably established. If you suspect credential compromise, you must take prompt action.",
        },
        {
          title: "4. Team use and administrator control",
          body:
            "The service may allow team or tenant administrators to invite members, configure permissions, manage visibility, and administer data. If you participate in a team, certain data may be visible to or managed by administrators according to the service design and configured permissions.",
        },
        {
          title: "5. Prohibited conduct",
          body:
            "You may not use the service for unlawful purposes, interfere with service operations, gain unauthorized access, use another person's account, reverse engineer the service, collect or disclose information without authorization, or upload malware or other harmful code.",
        },
        {
          title: "6. User content",
          body:
            "You represent that you have the rights necessary to upload or submit content to the service and that your content does not infringe third-party rights. As between you and us, your content remains yours or that of the applicable rights holder, but you grant us the rights needed to host, process, maintain, and improve the service.",
        },
        {
          title: "7. Availability and changes",
          body:
            "We may temporarily suspend all or part of the service for maintenance, incident response, security work, or product improvements. We aim to operate the service reliably, but we do not guarantee uninterrupted availability or error-free operation.",
        },
        {
          title: "8. Intellectual property",
          body:
            "The software, interface, logos, designs, documentation, and other materials related to the service belong to us or our licensors. Your right to use the service is limited, non-exclusive, non-transferable, and only for permitted use under these terms.",
        },
        {
          title: "9. Disclaimer",
          body:
            "The service is provided on an \"as is\" basis without warranties of any kind, whether express or implied, including fitness for a particular purpose, accuracy, availability, or non-infringement. Project execution, staffing, deadline control, and other business decisions remain your responsibility.",
        },
        {
          title: "10. Limitation of liability",
          body:
            "To the fullest extent permitted by law, we are not liable for indirect, incidental, special, consequential, or lost-profit damages, data loss, or business interruption arising from use of or inability to use the service, unless caused by our willful misconduct or gross negligence. Where liability cannot be excluded, our total liability will not exceed the fees paid by you to us for the service during the preceding 12 months.",
        },
        {
          title: "11. Suspension, termination, and changes",
          body:
            "If you violate these terms, we may suspend or terminate your access without prior notice. We may also update these terms when necessary and will give notice of material changes through the service or another appropriate method. Continued use after an update means you accept the revised terms.",
        },
      ],
    },
  },
  "zh-CN": {
    privacy: {
      title: "隐私政策",
      lastUpdated: "最后更新：2026年7月21日",
      backToLogin: "返回登录页",
      summary:
        "我们仅在提供项目管理服务与支持团队协作所必需的范围内处理信息。以下说明我们收集哪些信息、如何使用、如何保存，以及用户享有的权利。",
      sections: [
        {
          title: "1. 我们收集的信息",
          body:
            "我们会收集注册时由您提供的账户信息，例如邮箱地址、显示名和登录标识。同时也会保存您在使用服务过程中产生的数据，包括项目、任务、评论、负责人、截止日期、附件、通知设置和操作日志等。为保障安全和排查故障，我们还可能记录 IP 地址、浏览器信息、设备信息和访问时间等技术信息。",
        },
        {
          title: "2. 信息的使用目的",
          body:
            "我们将所收集的信息用于用户认证、提供项目管理功能、支持团队协作、发送通知、处理咨询、防止滥用、排查故障以及改进服务。我们不会出售个人信息，也不会将其用于与本服务无关的广告投放。",
        },
        {
          title: "3. 团队内的信息共享",
          body:
            "本服务默认面向团队协作使用。根据权限设置和租户配置，同一团队或同一租户内的成员可能可以查看项目名称、任务内容、进度、评论、负责人信息及相关工作数据。可见范围由系统行为和管理员配置的权限决定。",
        },
        {
          title: "4. 第三方服务商与披露",
          body:
            "为了提供服务，我们可能会使用基础设施、认证、监控、通知和文件存储等第三方服务商。我们会要求这些服务商采取适当的安全和保密措施。除法律要求外，我们不会向无关第三方披露用户信息。",
        },
        {
          title: "5. 存储与安全",
          body:
            "我们采用访问控制、传输加密、认证管理、审计日志和限流等合理的安全措施。但任何基于互联网或云的系统都无法保证绝对安全。数据（包括附件）可能保存在我们的系统中，也可能保存在为运营服务所使用的服务商系统中。",
        },
        {
          title: "6. Cookie 与类似技术",
          body:
            "我们可能会使用 Cookie 或类似技术来维持登录状态、保存语言设置、增强安全性并了解服务使用情况。这些技术主要用于提供和改进服务，而不是以跨站广告追踪为主要目的。",
        },
        {
          title: "7. 保留与删除",
          body:
            "账户信息和项目相关数据会在提供服务、履行法律义务、支持审计和处理争议所需的期间内保留。当用户申请关闭账户或删除数据时，我们会在合理范围内删除或匿名化相关数据；但因法律义务、备份或审计日志等原因，可能无法立即完全删除。",
        },
        {
          title: "8. 您的权利",
          body:
            "用户可以请求访问、更正、删除或限制使用与本人相关的个人信息。但如果该信息属于团队共享数据，或因法律、运营原因必须保留，则请求可能全部或部分受限。相关请求可通过我们另行指定的支持渠道提出。",
        },
        {
          title: "9. 政策变更",
          body:
            "我们可能会因法律、运营或产品变化而更新本政策。如发生重要变更，我们会通过服务内提示或其他适当方式通知。更新后继续使用本服务，即表示适用更新后的政策。",
        },
      ],
    },
    terms: {
      title: "服务条款",
      lastUpdated: "最后更新：2026年7月21日",
      backToLogin: "返回登录页",
      summary:
        "本条款规定了您使用我们项目管理 Web 服务时适用的条件。请在使用前阅读。",
      sections: [
        {
          title: "1. 同意条款",
          body:
            "当您访问、注册或使用本服务时，即视为您同意本服务条款。如果您不同意，请不要使用本服务。",
        },
        {
          title: "2. 服务说明",
          body:
            "本服务是用于管理和共享项目、任务、进度、负责人、截止时间、评论、附件及相关工作信息的 Web 项目管理产品。我们可能会不时新增、修改、暂停或终止部分服务内容。",
        },
        {
          title: "3. 账户责任",
          body:
            "您有责任提供准确的账户信息并妥善保管登录凭据。除非能够合理证明存在未经授权的使用，否则通过您账户进行的活动将视为您本人行为。如怀疑凭据泄露，您应立即采取必要措施。",
        },
        {
          title: "4. 团队使用与管理员控制",
          body:
            "本服务可能允许团队或租户管理员邀请成员、配置权限、管理可见范围以及管理数据。如果您加入某个团队，根据系统设计和权限配置，管理员可能可以查看或管理部分数据。",
        },
        {
          title: "5. 禁止行为",
          body:
            "您不得将本服务用于违法用途，不得干扰服务运行，不得进行未授权访问，不得使用他人账户，不得对服务进行逆向工程，不得在未获授权的情况下收集或披露信息，也不得上传恶意软件或其他有害代码。",
        },
        {
          title: "6. 用户内容",
          body:
            "您承诺自己拥有上传或提交到本服务的内容所需的权利，且该内容不侵犯第三方权利。在您与我们之间，您的内容仍归您或相关权利人所有；但您授予我们为托管、处理、维护和改进服务所必需的权利。",
        },
        {
          title: "7. 可用性与变更",
          body:
            "我们可能因维护、故障处理、安全工作或产品改进而暂时中止全部或部分服务。我们会尽力保持服务稳定，但不保证服务持续可用或完全无错误。",
        },
        {
          title: "8. 知识产权",
          body:
            "与本服务相关的软件、界面、标识、设计、文档和其他材料的知识产权归我们或我们的许可方所有。您获得的只是受限的、非独占的、不可转让的服务使用权。",
        },
        {
          title: "9. 免责声明",
          body:
            "本服务按“现状”提供，不附带任何明示或默示保证，包括但不限于适用于特定目的、准确性、可用性或不侵权的保证。项目执行、人员安排、期限管理及其他业务决策仍由您自行负责。",
        },
        {
          title: "10. 责任限制",
          body:
            "在法律允许的最大范围内，除因我们的故意或重大过失导致外，我们不对因使用或无法使用本服务而产生的间接损失、附带损失、特别损失、后果性损失、利润损失、数据丢失或业务中断承担责任。若责任无法完全排除，我们的责任总额不超过您在前 12 个月内为本服务向我们支付的费用总额。",
        },
        {
          title: "11. 暂停、终止与条款变更",
          body:
            "如果您违反本条款，我们可在不事先通知的情况下暂停或终止您的访问权限。我们也可能在必要时更新本条款，并会通过服务内提示或其他适当方式通知重大变更。更新后继续使用本服务，即视为您接受修订后的条款。",
        },
      ],
    },
  },
  "zh-TW": {
    privacy: {
      title: "隱私政策",
      lastUpdated: "最後更新：2026年7月21日",
      backToLogin: "返回登入頁",
      summary:
        "我們僅在提供專案管理服務與支援團隊協作所必要的範圍內處理資訊。以下說明我們收集哪些資訊、如何使用、如何保存，以及使用者享有的權利。",
      sections: [
        {
          title: "1. 我們收集的資訊",
          body:
            "我們會收集註冊時由您提供的帳戶資訊，例如電子郵件地址、顯示名稱與登入識別。同時也會保存您在使用服務過程中產生的資料，包括專案、任務、留言、負責人、截止日期、附件、通知設定與操作日誌等。為保障安全與排查故障，我們也可能記錄 IP 位址、瀏覽器資訊、裝置資訊與存取時間等技術資訊。",
        },
        {
          title: "2. 資訊的使用目的",
          body:
            "我們將所收集的資訊用於使用者驗證、提供專案管理功能、支援團隊協作、發送通知、處理諮詢、防止濫用、排查故障以及改進服務。我們不會出售個人資訊，也不會將其用於與本服務無關的廣告投放。",
        },
        {
          title: "3. 團隊內的資訊共享",
          body:
            "本服務預設面向團隊協作使用。根據權限設定與租戶配置，同一團隊或同一租戶內的成員可能可以查看專案名稱、任務內容、進度、留言、負責人資訊及相關工作資料。可見範圍由系統行為與管理員設定的權限決定。",
        },
        {
          title: "4. 第三方服務商與揭露",
          body:
            "為了提供服務，我們可能會使用基礎設施、驗證、監控、通知與檔案儲存等第三方服務商。我們會要求這些服務商採取適當的安全與保密措施。除法律要求外，我們不會向無關第三方揭露使用者資訊。",
        },
        {
          title: "5. 儲存與安全",
          body:
            "我們採用存取控制、傳輸加密、驗證管理、稽核日誌與限流等合理的安全措施。但任何基於網際網路或雲端的系統都無法保證絕對安全。資料（包括附件）可能保存在我們的系統中，也可能保存在為營運服務所使用的服務商系統中。",
        },
        {
          title: "6. Cookie 與類似技術",
          body:
            "我們可能會使用 Cookie 或類似技術來維持登入狀態、保存語言設定、增強安全性並了解服務使用情況。這些技術主要用於提供與改進服務，而不是以跨站廣告追蹤為主要目的。",
        },
        {
          title: "7. 保留與刪除",
          body:
            "帳戶資訊與專案相關資料會在提供服務、履行法律義務、支援稽核與處理爭議所需的期間內保留。當使用者申請關閉帳戶或刪除資料時，我們會在合理範圍內刪除或匿名化相關資料；但因法律義務、備份或稽核日誌等原因，可能無法立即完全刪除。",
        },
        {
          title: "8. 您的權利",
          body:
            "使用者可以要求存取、更正、刪除或限制使用與本人相關的個人資訊。但若該資訊屬於團隊共享資料，或因法律、營運原因必須保留，則請求可能全部或部分受限。相關請求可透過我們另行指定的支援管道提出。",
        },
        {
          title: "9. 政策變更",
          body:
            "我們可能因法律、營運或產品變更而更新本政策。如有重大變更，我們會透過服務內提示或其他適當方式通知。更新後繼續使用本服務，即表示適用更新後的政策。",
        },
      ],
    },
    terms: {
      title: "服務條款",
      lastUpdated: "最後更新：2026年7月21日",
      backToLogin: "返回登入頁",
      summary:
        "本條款規定了您使用我們專案管理 Web 服務時適用的條件。請在使用前閱讀。",
      sections: [
        {
          title: "1. 同意條款",
          body:
            "當您存取、註冊或使用本服務時，即視為您同意本服務條款。如果您不同意，請不要使用本服務。",
        },
        {
          title: "2. 服務說明",
          body:
            "本服務是用於管理與共享專案、任務、進度、負責人、截止時間、留言、附件及相關工作資訊的 Web 專案管理產品。我們可能會不時新增、修改、暫停或終止部分服務內容。",
        },
        {
          title: "3. 帳戶責任",
          body:
            "您有責任提供正確的帳戶資訊並妥善保管登入憑證。除非能合理證明存在未經授權的使用，否則透過您帳戶進行的活動將視為您本人行為。如懷疑憑證外洩，您應立即採取必要措施。",
        },
        {
          title: "4. 團隊使用與管理員控制",
          body:
            "本服務可能允許團隊或租戶管理員邀請成員、設定權限、管理可見範圍以及管理資料。如果您加入某個團隊，根據系統設計與權限設定，管理員可能可以查看或管理部分資料。",
        },
        {
          title: "5. 禁止行為",
          body:
            "您不得將本服務用於違法用途，不得干擾服務運作，不得進行未授權存取，不得使用他人帳戶，不得對服務進行逆向工程，不得在未獲授權的情況下收集或揭露資訊，也不得上傳惡意軟體或其他有害程式碼。",
        },
        {
          title: "6. 使用者內容",
          body:
            "您承諾自己擁有上傳或提交到本服務之內容所需的權利，且該內容不侵害第三方權利。在您與我們之間，您的內容仍歸您或相關權利人所有；但您授予我們為託管、處理、維護與改進服務所必需的權利。",
        },
        {
          title: "7. 可用性與變更",
          body:
            "我們可能因維護、故障處理、安全工作或產品改進而暫時中止全部或部分服務。我們會盡力維持服務穩定，但不保證服務持續可用或完全無錯誤。",
        },
        {
          title: "8. 智慧財產權",
          body:
            "與本服務相關的軟體、介面、標誌、設計、文件與其他材料之智慧財產權歸我們或我們的授權方所有。您獲得的僅是受限的、非獨占的、不可轉讓的服務使用權。",
        },
        {
          title: "9. 免責聲明",
          body:
            "本服務按「現況」提供，不附帶任何明示或默示保證，包括但不限於特定目的適用性、正確性、可用性或不侵權的保證。專案執行、人員安排、期限管理及其他業務決策仍由您自行負責。",
        },
        {
          title: "10. 責任限制",
          body:
            "在法律允許的最大範圍內，除因我們的故意或重大過失導致外，我們不對因使用或無法使用本服務而產生的間接損失、附帶損失、特別損失、後果性損失、利潤損失、資料遺失或業務中斷承擔責任。若責任無法完全排除，我們的責任總額不超過您在前 12 個月內就本服務向我們支付的費用總額。",
        },
        {
          title: "11. 暫停、終止與條款變更",
          body:
            "如果您違反本條款，我們可在不事先通知的情況下暫停或終止您的存取權限。我們也可能在必要時更新本條款，並會透過服務內提示或其他適當方式通知重大變更。更新後繼續使用本服務，即視為您接受修訂後的條款。",
        },
      ],
    },
  },
};

export const getLegalDocument = (
  locale: string,
  kind: LegalDocumentKind
): LegalDocument => {
  const normalizedLocale = LEGAL_CONTENT[locale] ? locale : "ja-JP";
  return LEGAL_CONTENT[normalizedLocale][kind];
};
