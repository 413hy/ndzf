# API 资源使用说明

本目录只存放通用 API 资源，不包含账号 session，也不包含授权文件。

## 文件

- `api_pool.txt`
  - 一行一个 API，格式为 `api_id|api_hash`。
  - 当前共 1782 条。

- `config.api_pool.json`
  - 只包含 `api_pool` 字段。
  - 适合给维护人员合并到安装目录的 `config.json`。

## 推荐使用方式

安装软件后，打开软件：

1. 进入“设置”或“API 池”页面。
2. 打开 `api_pool.txt`。
3. 复制全部内容。
4. 粘贴到软件的 API 池输入框。
5. 保存配置。

## 不建议直接覆盖

不要直接用 `config.api_pool.json` 覆盖安装目录里的 `config.json`，否则可能覆盖员工自己的配置。

如果确实要手动合并，只把 `config.api_pool.json` 里的 `api_pool` 字段合并进安装目录的 `config.json`。
