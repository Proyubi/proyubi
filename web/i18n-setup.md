# 客户 Web 端 i18n 配置指南（React + Ant Design）

## 安装依赖

```bash
npm install react-i18next i18next
# 或
pnpm add react-i18next i18next
```

## 目录结构

```
src/
  locales/
    index.ts              # i18n 初始化配置
    zh_CN.json           # 中文翻译文件
    en.json              # 英文翻译文件
    ja.json              # 日文翻译文件
  components/
    LanguageSwitcher.tsx # 语言切换组件
```

## 配置文件示例

### src/locales/index.ts

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './zh_CN.json';
import en from './en.json';
import ja from './ja.json';

// 从 localStorage 读取用户选择的语言，默认英文
const savedLang = localStorage.getItem('app_lang') || 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      zh_CN: { translation: zhCN },
      en: { translation: en },
      ja: { translation: ja },
    },
    lng: savedLang,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

// 语言切换时，同步更新 API 请求头
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('app_lang', lng);
  // 更新 axios 请求头（如果使用 axios）
  // axios.defaults.headers.common['Accept-Language'] = lng === 'zh_CN' ? 'zh-CN' : lng;
});

export default i18n;
```

### src/locales/zh_CN.json

```json
{
  "common": {
    "confirm": "确认",
    "cancel": "取消",
    "save": "保存",
    "delete": "删除",
    "edit": "编辑",
    "search": "搜索"
  },
  "menu": {
    "products": "商品管理",
    "inventory": "库存管理",
    "inbound": "入库",
    "outbound": "出库",
    "stocktake": "盘点"
  }
}
```

### src/locales/en.json

```json
{
  "common": {
    "confirm": "Confirm",
    "cancel": "Cancel",
    "save": "Save",
    "delete": "Delete",
    "edit": "Edit",
    "search": "Search"
  },
  "menu": {
    "products": "Products",
    "inventory": "Inventory",
    "inbound": "Inbound",
    "outbound": "Outbound",
    "stocktake": "Stocktake"
  }
}
```

### src/locales/ja.json

```json
{
  "common": {
    "confirm": "確認",
    "cancel": "キャンセル",
    "save": "保存",
    "delete": "削除",
    "edit": "編集",
    "search": "検索"
  },
  "menu": {
    "products": "商品管理",
    "inventory": "在庫管理",
    "inbound": "入庫",
    "outbound": "出庫",
    "stocktake": "棚卸"
  }
}
```

## 使用方式

### 在组件中使用

```typescript
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();
  
  return (
    <div>
      <h1>{t('menu.products')}</h1>
      <button>{t('common.save')}</button>
    </div>
  );
}
```

### 语言切换组件

```typescript
// src/components/LanguageSwitcher.tsx
import { useTranslation } from 'react-i18next';
import { Select } from 'antd';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const languages = [
    { label: 'English', value: 'en' },
    { label: '简体中文', value: 'zh_CN' },
    { label: '日本語', value: 'ja' },
  ];

  const handleChange = (lang: string) => {
    i18n.changeLanguage(lang);
    // 更新 API 请求头
    // axios.defaults.headers.common['Accept-Language'] = lang === 'zh_CN' ? 'zh-CN' : lang;
    // 重新获取菜单等动态数据
    // fetchMenus();
  };

  return (
    <Select
      value={i18n.language}
      onChange={handleChange}
      options={languages}
      style={{ width: 120 }}
    />
  );
}
```

## 动态数据（菜单）处理

菜单数据从 API 获取时，后端已根据 `Accept-Language` 请求头返回翻译后的 `menu_name`，前端直接使用即可：

```typescript
// 菜单数据示例（从 API 返回）
const menus = [
  { id: '1', menuName: 'Products', path: '/products' }, // 已翻译
  { id: '2', menuName: 'Inventory', path: '/inventory' }, // 已翻译
];

// 直接渲染，无需额外翻译
menus.map(menu => <Menu.Item key={menu.id}>{menu.menuName}</Menu.Item>);
```

## API 请求头设置

确保所有 API 请求都带上 `Accept-Language` 头：

```typescript
// 使用 axios
import axios from 'axios';

axios.interceptors.request.use((config) => {
  const lang = i18n.language === 'zh_CN' ? 'zh-CN' : i18n.language;
  config.headers['Accept-Language'] = lang;
  return config;
});
```

