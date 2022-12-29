import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

import * as Icons from '@element-plus/icons'
import { toLine } from './utils'

import App from './App.vue'
import router from './router/index'

const app = createApp(App)

// 全局注册图标 牺牲一点性能
// el-icon-xxx
for (let i in Icons) {
  // 注册全部组件
  console.log((Icons as any)[i]);
  
  app.component(`el-icon-${toLine(i)}`, (Icons as any)[i])
}

app.use(ElementPlus).use(router)
app.mount('#app')
