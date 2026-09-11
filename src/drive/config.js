// Google OAuth 用戶端設定。
// client id 不是機密（它會出現在每一次授權的網址上），可以進版控；
// client secret 則絕對不放這裡也不需要——PKCE public client 流程不使用它。
// 注意：OAuth client 類型必須是「Chrome 擴充功能 / Chrome Extension」。
// Web application 類型是 confidential client，token endpoint 強制要 client_secret
// （實測：invalid_request, client_secret is missing），extension 走不通。
// Chrome Extension 類型的 client id 實際上寫在 manifest.json 的 oauth2 欄位，由 Chrome 使用；
// 這裡保留一份只是為了在設定頁顯示與檢查。
export const CLIENT_ID = "778676922326-43qiqnkaigpj10umrar0vnsn749fapq7.apps.googleusercontent.com";

/** 只要這一個 scope：只能存取本 extension 自己建立的檔案。 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// Drive 上的根資料夾名稱；同步的檔案都放在它底下，scope 是 drive.file，
// 也就是「只碰這個 extension 自己建立的檔案」。
export const ROOT_FOLDER = "Udemy Boost";
