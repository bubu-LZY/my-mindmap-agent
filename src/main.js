import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import './styles/variables.css'
import { runLegacyMigration } from './utils/legacyMigrate'

// 旧版本数据迁移：先于挂载完成，避免 UI 以空数据初始化后覆盖合并结果
runLegacyMigration().finally(() => {
  const app = createApp(App)

  app.use(createPinia())
  app.use(ElementPlus)

  app.mount('#app')
})
