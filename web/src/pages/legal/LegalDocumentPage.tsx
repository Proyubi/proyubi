import { ArrowLeftOutlined } from "@ant-design/icons";
import { Helmet, history, useIntl } from "@umijs/max";
import { Button, Card, Typography } from "antd";
import { createStyles } from "antd-style";
import React from "react";
import { SelectLang } from "@/components";
import { LOGO_URL } from "@/constants/assets";
import { getLegalDocument, type LegalDocumentKind } from "./content";

const { Paragraph, Text, Title } = Typography;

const PRIMARY_GREEN = "#44C97D";

const useStyles = createStyles(() => ({
  page: {
    minHeight: "100vh",
    background: PRIMARY_GREEN,
    padding: "32px 20px 48px",
    position: "relative",
  },
  langSwitcher: {
    position: "absolute",
    top: 20,
    right: 24,
    zIndex: 10,
    color: "#fff",
    "& span": {
      color: "#fff",
    },
  },
  shell: {
    maxWidth: 960,
    margin: "0 auto",
  },
  brand: {
    textAlign: "center",
    color: "#fff",
    marginBottom: 24,
    paddingTop: 28,
  },
  logo: {
    height: 48,
    width: "auto",
    marginBottom: 12,
  },
  brandTitle: {
    color: "#fff !important",
    marginBottom: "8px !important",
  },
  brandText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    margin: 0,
  },
  card: {
    borderRadius: 20,
    boxShadow: "0 20px 60px rgba(0,0,0,0.12)",
  },
  backBtn: {
    paddingInline: 0,
    marginBottom: 8,
  },
  section: {
    "&:not(:last-child)": {
      marginBottom: 28,
    },
  },
  sectionTitle: {
    fontSize: 20,
    marginBottom: "8px !important",
  },
  sectionBody: {
    whiteSpace: "pre-line",
    fontSize: 15,
    lineHeight: 1.8,
    marginBottom: "0 !important",
  },
}));

type Props = {
  kind: LegalDocumentKind;
};

const LegalDocumentPage: React.FC<Props> = ({ kind }) => {
  const intl = useIntl();
  const { styles } = useStyles();
  const doc = getLegalDocument(intl.locale, kind);

  return (
    <>
      <Helmet title={`${doc.title} - プロジェクト管理`} />
      <div className={styles.page}>
        <div className={styles.langSwitcher}>
          <SelectLang />
        </div>

        <div className={styles.shell}>
          <div className={styles.brand}>
            <img className={styles.logo} src={LOGO_URL} alt="logo" />
            <Title level={2} className={styles.brandTitle}>
              {doc.title}
            </Title>
            <p className={styles.brandText}>{doc.summary}</p>
          </div>

          <Card className={styles.card}>
            <Button
              type="link"
              icon={<ArrowLeftOutlined />}
              className={styles.backBtn}
              onClick={() => history.push("/user/login")}
            >
              {doc.backToLogin}
            </Button>

            <Title level={2} style={{ marginBottom: 4 }}>
              {doc.title}
            </Title>
            <Text type="secondary">{doc.lastUpdated}</Text>

            <div style={{ marginTop: 28 }}>
              {doc.sections.map((section) => (
                <section key={section.title} className={styles.section}>
                  <Title level={4} className={styles.sectionTitle}>
                    {section.title}
                  </Title>
                  <Paragraph className={styles.sectionBody}>
                    {section.body}
                  </Paragraph>
                </section>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
};

export default LegalDocumentPage;
