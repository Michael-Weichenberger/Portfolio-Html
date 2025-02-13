function toggleInfo(projectId) {
    var moreInfo = document.getElementById(projectId);
    if (moreInfo.style.display === "none" || moreInfo.style.display === "") {
        moreInfo.style.display = "block";
    } else {
        moreInfo.style.display = "none";
    }
}